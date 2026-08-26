/**
 * Compare two semver versions.
 * @param {string} a - First version.
 * @param {string} b - Second version.
 * @returns {number} 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a, b) {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);

    for (let index = 0; index < 3; index++) {
        const partA = partsA[index] || 0;
        const partB = partsB[index] || 0;

        if (partA > partB) {
            return 1;
        }
        if (partA < partB) {
            return -1;
        }
    }

    return 0;
}
