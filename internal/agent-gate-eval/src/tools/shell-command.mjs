// Plain JavaScript so codex-agent-hook.mjs can import it without tsx; shell-command.d.mts types it.

const CHAIN_OPERATORS = ["&&", "||"];
const CHAIN_SEPARATORS = new Set([";", "\n"]);
const QUOTES = new Set(["'", '"', "`"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DECLARATION_WORDS = new Set(["export", "local", "readonly"]);
const ECHO_FLAG = /^-[neE]+$/;
// An echo argument that expands, globs, redirects or escapes prints something only a stub can say.
const BEYOND_A_LITERAL = /[$`*?[\]{}()<>|&\\]/;

/**
 * `text` cut at each boundary outside quotes and parentheses, each piece with the boundary before it (`""` for
 * the first); null when a quote or parenthesis never closes.
 */
function splitOutsideQuotes(text, boundaryLengthAt) {
    const pieces = [];
    let current = { text: "", after: "" };
    let quote = null;
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === "\\" && quote !== "'") {
            current.text += text.slice(index, index + 2);
            index += 1;
            continue;
        }
        if (quote) {
            current.text += character;
            if (character === quote) quote = null;
            continue;
        }
        const boundaryLength = depth === 0 ? boundaryLengthAt(text, index) : 0;
        if (boundaryLength > 0) {
            pieces.push(current);
            current = { text: "", after: text.slice(index, index + boundaryLength) };
            index += boundaryLength - 1;
            continue;
        }
        if (QUOTES.has(character)) quote = character;
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
        current.text += character;
    }
    if (quote || depth !== 0) return null;
    pieces.push(current);
    return pieces;
}

function chainBoundaryLengthAt(text, index) {
    if (CHAIN_OPERATORS.includes(text.slice(index, index + 2))) return 2;
    return CHAIN_SEPARATORS.has(text[index]) ? 1 : 0;
}

function whitespaceLengthAt(text, index) {
    return /\s/.test(text[index]) ? 1 : 0;
}

/** The commands a chained shell command runs in turn; see shell-command.d.mts. */
export function chainedCommands(command) {
    const whole = [{ command: command, isConditional: false }];
    // A heredoc body can hold any separator, and nothing marks where it ends short of parsing it.
    if (command.includes("<<")) return whole;
    const pieces = splitOutsideQuotes(command, chainBoundaryLengthAt);
    if (pieces === null) return whole;
    const chain = [];
    let isConditional = false;
    for (const piece of pieces) {
        // `a &&` then a newline still makes the next command conditional on `a`.
        isConditional = isConditional || CHAIN_OPERATORS.includes(piece.after);
        if (piece.text.trim() === "") continue;
        chain.push({ command: piece.text.trim(), isConditional: isConditional });
        isConditional = false;
    }
    return chain;
}

/** A command stage's words, quotes removed; null when its quoting does not close. */
export function shellWords(text) {
    const words = [];
    let current = "";
    let quote = null;
    let inWord = false;
    for (const character of text) {
        if (quote) {
            if (character === quote) quote = null;
            else current += character;
        } else if (character === "'" || character === '"') {
            quote = character;
            inWord = true;
        } else if (/\s/.test(character)) {
            if (inWord) words.push(current);
            current = "";
            inWord = false;
        } else {
            current += character;
            inWord = true;
        }
    }
    if (quote) return null;
    if (inWord) words.push(current);
    return words;
}

/** What a chained command prints with no stub, when the shell alone decides it; see shell-command.d.mts. */
export function builtinOutput(chained) {
    const words = (splitOutsideQuotes(chained.command, whitespaceLengthAt) ?? [])
        .map((piece) => piece.text)
        .filter((word) => word !== "");
    if (words.length === 0) return undefined;
    if (words[0] === "cd") return "";
    const assignments = DECLARATION_WORDS.has(words[0]) ? words.slice(1) : words;
    if (assignments.length > 0 && assignments.every((word) => ASSIGNMENT.test(word))) return "";
    const echoed = words.slice(1);
    if (words[0] !== "echo" || echoed.some((word) => ECHO_FLAG.test(word) || BEYOND_A_LITERAL.test(word))) {
        return undefined;
    }
    // Printing a conditional echo would print both arms of `a && echo yes || echo no`.
    return chained.isConditional ? "" : (shellWords(echoed.join(" ")) ?? []).join(" ");
}
