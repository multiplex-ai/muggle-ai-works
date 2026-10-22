# Windows backend for guard-run. Callers never invoke this file: the portable
# entry point is guard-run.mjs (plain node, runs everywhere), which probes the
# platform and dispatches to one backend — this Job Object shim on win32,
# systemd scope / prlimit on linux, ulimit + process group on darwin. So skill
# instructions stay OS-agnostic by referencing guard-run.mjs only; PowerShell
# exists solely inside this win32 backend. guard-run.mjs invokes it as:
#
#   powershell -File guard-run-job-object.ps1 <limit> <kill|persist> <launcherPid> <base64CommandLine>
#
# The child is created CREATE_SUSPENDED, assigned to a fresh Job Object, then
# resumed — so it and every descendant are inside the job from their first
# instruction. JOB_OBJECT_LIMIT_ACTIVE_PROCESS makes the process past the limit
# fail at creation in the kernel (nothing to clean up), which is what stops a
# fork storm: a sweeper that reacts after enumeration always loses that race.
#
# kill mode adds JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE — this shim holds the only
# job handle, so when it exits or is killed the kernel destroys the entire tree
# — and watches the launcher: if the node launcher dies first, the shim
# terminates the job so orphans are impossible. persist mode (guard-run
# --service) keeps only the cap; the tree may outlive the launcher.

$ErrorActionPreference = "Stop"

if ($args.Count -ne 4) {
    [Console]::Error.WriteLine("usage: guard-run-job-object.ps1 <limit> <kill|persist> <launcherPid> <base64CommandLine>")
    exit 2
}

$activeProcessLimit = 0
if (-not [int]::TryParse($args[0], [ref]$activeProcessLimit) -or $activeProcessLimit -lt 1) {
    [Console]::Error.WriteLine("guard-run-job-object: limit must be a positive integer")
    exit 2
}
if ($args[1] -notin @("kill", "persist")) {
    [Console]::Error.WriteLine("guard-run-job-object: mode must be 'kill' or 'persist'")
    exit 2
}
$killOnClose = $args[1] -eq "kill"
$launcherPid = 0
if (-not [int]::TryParse($args[2], [ref]$launcherPid)) {
    [Console]::Error.WriteLine("guard-run-job-object: launcherPid must be an integer")
    exit 2
}
try {
    $commandLine = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[3]))
} catch {
    [Console]::Error.WriteLine("guard-run-job-object: command line is not valid base64")
    exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace MuggleGuardRun
{
    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_ASSOCIATE_COMPLETION_PORT
    {
        public IntPtr CompletionKey;
        public IntPtr CompletionPort;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    public static class JobObjectLauncher
    {
        const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        const int JobObjectExtendedLimitInformation = 9;
        const int JobObjectAssociateCompletionPortInformation = 7;
        const uint JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT = 3;
        const int LIMIT_WATCHER_DRAIN_TIMEOUT_MS = 2000;
        const uint CREATE_SUSPENDED = 0x00000004;
        const uint SYNCHRONIZE = 0x00100000;
        const uint INFINITE = 0xFFFFFFFF;
        const uint WAIT_OBJECT_0 = 0;
        const int LAUNCHER_DEATH_EXIT_CODE = 137;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInfoClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInfoClass,
            ref JOBOBJECT_ASSOCIATE_COMPLETION_PORT lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateIoCompletionPort(IntPtr fileHandle, IntPtr existingCompletionPort,
            UIntPtr completionKey, uint numberOfConcurrentThreads);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetQueuedCompletionStatus(IntPtr completionPort, out uint numberOfBytes,
            out UIntPtr completionKey, out IntPtr overlapped, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool PostQueuedCompletionStatus(IntPtr completionPort, uint numberOfBytes,
            UIntPtr completionKey, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles,
            uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint WaitForMultipleObjects(uint nCount, IntPtr[] lpHandles, bool bWaitAll,
            uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        static Exception LastError(string operation)
        {
            return new Exception(operation + " failed (Win32 error " +
                Marshal.GetLastWin32Error() + ")");
        }

        // A creation the job refuses reaches the caller only as a bare Win32
        // failure (libuv: "spawn UNKNOWN"), which never names the cap. The job's
        // completion port does, so a background thread drains it and says so —
        // draining continuously also keeps a long --service run's per-process
        // messages from piling up in the port.
        static Thread StartLimitWatcher(IntPtr port, int activeProcessLimit)
        {
            Thread watcher = new Thread(() =>
            {
                bool hasReported = false;
                while (true)
                {
                    uint message;
                    UIntPtr completionKey;
                    IntPtr overlapped;
                    if (!GetQueuedCompletionStatus(port, out message, out completionKey,
                        out overlapped, INFINITE))
                    {
                        return;
                    }
                    if (completionKey == UIntPtr.Zero) return;
                    if (message == JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT && !hasReported)
                    {
                        hasReported = true;
                        Console.Error.WriteLine("guard-run: the process tree reached its active-process " +
                            "limit of " + activeProcessLimit + "; the kernel refused process creation past it, " +
                            "which the refused caller reports as \"spawn UNKNOWN\". Raise it with --limit.");
                    }
                }
            });
            watcher.IsBackground = true;
            watcher.Start();
            return watcher;
        }

        // The stop marker queues behind every job message already posted, so the
        // watcher reports a refusal that happened just before the tree exited.
        static void StopLimitWatcher(IntPtr port, Thread watcher)
        {
            PostQueuedCompletionStatus(port, 0, UIntPtr.Zero, IntPtr.Zero);
            watcher.Join(LIMIT_WATCHER_DRAIN_TIMEOUT_MS);
        }

        public static int Run(string commandLine, int activeProcessLimit, bool killOnClose,
            int launcherPid)
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw LastError("CreateJobObject");

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                | (killOnClose ? JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE : 0);
            limits.BasicLimitInformation.ActiveProcessLimit = (uint)activeProcessLimit;
            uint limitsSize = (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits,
                limitsSize))
            {
                throw LastError("SetInformationJobObject");
            }

            IntPtr port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
            if (port == IntPtr.Zero) throw LastError("CreateIoCompletionPort");
            JOBOBJECT_ASSOCIATE_COMPLETION_PORT association = new JOBOBJECT_ASSOCIATE_COMPLETION_PORT();
            association.CompletionKey = job;
            association.CompletionPort = port;
            if (!SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation,
                ref association, (uint)Marshal.SizeOf(typeof(JOBOBJECT_ASSOCIATE_COMPLETION_PORT))))
            {
                throw LastError("SetInformationJobObject (completion port)");
            }
            Thread limitWatcher = StartLimitWatcher(port, activeProcessLimit);

            STARTUPINFO startupInfo = new STARTUPINFO();
            startupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            PROCESS_INFORMATION processInfo;
            StringBuilder mutableCommandLine = new StringBuilder(commandLine);
            if (!CreateProcess(null, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED, IntPtr.Zero, null, ref startupInfo, out processInfo))
            {
                throw LastError("CreateProcess for [" + commandLine + "]");
            }
            if (!AssignProcessToJobObject(job, processInfo.hProcess))
            {
                TerminateProcess(processInfo.hProcess, 1);
                throw LastError("AssignProcessToJobObject");
            }
            ResumeThread(processInfo.hThread);

            if (killOnClose)
            {
                IntPtr launcher = OpenProcess(SYNCHRONIZE, false, (uint)launcherPid);
                if (launcher == IntPtr.Zero)
                {
                    // Launcher already gone: the tree is orphaned at birth — reap it.
                    TerminateJobObject(job, LAUNCHER_DEATH_EXIT_CODE);
                    return LAUNCHER_DEATH_EXIT_CODE;
                }
                IntPtr[] handles = new IntPtr[] { processInfo.hProcess, launcher };
                uint signaled = WaitForMultipleObjects(2, handles, false, INFINITE);
                if (signaled == WAIT_OBJECT_0 + 1)
                {
                    TerminateJobObject(job, LAUNCHER_DEATH_EXIT_CODE);
                    return LAUNCHER_DEATH_EXIT_CODE;
                }
            }
            else
            {
                WaitForSingleObject(processInfo.hProcess, INFINITE);
            }
            StopLimitWatcher(port, limitWatcher);

            uint exitCode;
            if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
            {
                throw LastError("GetExitCodeProcess");
            }
            // The job handle is deliberately never closed here: in kill mode this
            // process's death is what closes it, and that close is the kernel's
            // cue to destroy any stragglers.
            return (int)exitCode;
        }
    }
}
'@

try {
    exit ([MuggleGuardRun.JobObjectLauncher]::Run($commandLine, $activeProcessLimit, $killOnClose, $launcherPid))
} catch {
    [Console]::Error.WriteLine("guard-run-job-object: $($_.Exception.Message)")
    exit 1
}
