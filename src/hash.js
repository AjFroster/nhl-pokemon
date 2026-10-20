// A fingerprint of a whole league, used to check that the same seed always
// plays out the same way, in Node and in the browser. Two 53-bit cyrb53 hashes
// with different seeds, so a collision is out of the question for our use.

const cyrb53 = (str, seed) => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
};

export const hashString = (str) => cyrb53(str, 1) + cyrb53(str, 2);

export const stateHash = (state) => hashString(JSON.stringify(state));
