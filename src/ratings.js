// Pokémon NHL: turns a species' base stats, size and type into hockey skills
// and position ratings. Works in the browser and in Node (plain ES module).

export const SKILLS = {
  hgt: "Height",
  stre: "Strength",
  spd: "Skating speed",
  endu: "Endurance",
  pss: "Passing",
  wst: "Wrist shot",
  sst: "Slap shot",
  stk: "Stickhandling",
  oiq: "Offensive IQ",
  chk: "Checking",
  blk: "Shot blocking",
  fcf: "Faceoffs",
  diq: "Defensive IQ",
  glk: "Goaltending",
};

// Big outliers (Blissey's HP, Shuckle's defenses) still help, but at half rate past 130.
const soften = (x) => (x <= 130 ? x : 130 + (x - 130) * 0.5);

// Size expressed on the same scale as a base stat (about 10 to 160).
const clampStat = (x) => Math.max(10, Math.min(160, x));
const sizeStats = (heightm, weightkg) => ({
  ht: clampStat(70 + 30 * Math.log2(Math.max(heightm, 0.1) / 1.5)),
  wt: clampStat(70 + 22 * Math.log2(Math.max(weightkg, 0.1) / 60)),
});

// Each skill is a weighted blend of stats, in base-stat units.
export const RECIPES = {
  hgt: { ht: 1 },
  stre: { atk: 0.4, wt: 0.4, hp: 0.2 },
  spd: { spe: 1 },
  endu: { hp: 0.5, def: 0.25, spd: 0.25 },
  pss: { spa: 0.6, spe: 0.2, spd: 0.2 },
  wst: { atk: 0.5, spe: 0.3, spa: 0.2 },
  sst: { atk: 0.6, wt: 0.25, ht: 0.15 },
  stk: { spe: 0.45, spa: 0.4, atk: 0.15 },
  oiq: { spa: 0.7, spd: 0.15, spe: 0.15 },
  chk: { atk: 0.4, wt: 0.35, def: 0.25 },
  blk: { def: 0.5, hp: 0.3, wt: 0.2 },
  fcf: { atk: 0.35, spe: 0.35, spa: 0.3 },
  diq: { spd: 0.5, def: 0.3, spa: 0.2 },
  glk: { spd: 0.3, def: 0.25, spe: 0.15, ht: 0.15, wt: 0.15 },
};

// Type flavour: small nudges on top of the stats.
export const TYPE_BONUS = {
  Ice: { spd: 6, endu: 4, glk: 3 },
  Fire: { endu: -4, sst: 3 },
  Water: { spd: 3, pss: 2 },
  Electric: { spd: 4, wst: 4 },
  Psychic: { oiq: 6, pss: 4 },
  Fighting: { chk: 6, stre: 4, fcf: 3 },
  Steel: { blk: 6, glk: 4 },
  Rock: { blk: 5, chk: 3, spd: -3 },
  Ground: { stre: 4, spd: -3 },
  Ghost: { stk: 6, wst: 2 },
  Dark: { diq: 5, stk: 3 },
  Fairy: { pss: 5, oiq: 2 },
  Dragon: { sst: 5, stre: 2 },
  Flying: { spd: 3, chk: -3 },
  Bug: { endu: 4, blk: 2 },
  Grass: { endu: 3, diq: 2 },
  Poison: { chk: 3, diq: 2 },
  Normal: { oiq: 2, diq: 2, endu: 2 },
};

// A composite of 20 maps to 0 and 150 maps to 100.
const toSkill = (x) => Math.max(1, Math.min(100, Math.round(((x - 20) / 130) * 100)));

// Skills from six stats in base-stat units, plus size and type.
export const skillsFromStats = (bs, heightm, weightkg, types) => {
  const stats = {
    hp: soften(bs.hp),
    atk: soften(bs.atk),
    def: soften(bs.def),
    spa: soften(bs.spa),
    spd: soften(bs.spd),
    spe: soften(bs.spe),
    ...sizeStats(heightm, weightkg),
  };
  const skills = {};
  for (const [skill, recipe] of Object.entries(RECIPES)) {
    let x = 0;
    for (const [stat, weight] of Object.entries(recipe)) x += stats[stat] * weight;
    for (const type of types) x += TYPE_BONUS[type]?.[skill] ?? 0;
    skills[skill] = toSkill(x);
  }
  return skills;
};

// A species' skills from its base stats, as an average individual at level 50.
export const speciesSkills = (p) => skillsFromStats(p.bs, p.h, p.w, p.types);

// How much each skill matters at each position.
export const POSITION_WEIGHTS = {
  C: { fcf: 4, pss: 4, oiq: 3, stk: 3, spd: 3, wst: 2, diq: 3, chk: 1, endu: 2, stre: 1 },
  W: { wst: 4, sst: 3, spd: 4, oiq: 2, stk: 2, pss: 1, chk: 2, endu: 1, stre: 2 },
  D: { blk: 4, chk: 4, diq: 4, stre: 3, sst: 2, pss: 2, hgt: 1, spd: 1, endu: 1 },
  G: { glk: 6, hgt: 1, diq: 1, endu: 1 },
};
export const POSITIONS = ["C", "W", "D", "G"];

export const positionRating = (skills, pos) => {
  let total = 0;
  let sum = 0;
  for (const [skill, weight] of Object.entries(POSITION_WEIGHTS[pos])) {
    total += skills[skill] * weight;
    sum += weight;
  }
  return Math.round(total / sum);
};

export const rateSpecies = (p) => {
  const skills = speciesSkills(p);
  const ovrs = Object.fromEntries(POSITIONS.map((pos) => [pos, positionRating(skills, pos)]));
  const best = POSITIONS.reduce((a, b) => (ovrs[b] > ovrs[a] ? b : a));
  return { skills, ovrs, best };
};

export const isLegendary = (p) =>
  (p.tags ?? []).some(
    (t) => t === "Restricted Legendary" || t === "Sub-Legendary" || t === "Mythical" || t === "Ultra Beast",
  );

// 32 Gym Leader teams, one division per region, two conferences, like the NHL.
export const TEAMS = [
  // Kanto division (Indigo conference)
  { abbr: "PEW", city: "Pewter", name: "Boulders", leader: "Brock", type: "Rock", div: "Kanto" },
  { abbr: "CER", city: "Cerulean", name: "Cascades", leader: "Misty", type: "Water", div: "Kanto" },
  { abbr: "VER", city: "Vermilion", name: "Thunder", leader: "Lt. Surge", type: "Electric", div: "Kanto" },
  { abbr: "CEL", city: "Celadon", name: "Rainbows", leader: "Erika", type: "Grass", div: "Kanto" },
  { abbr: "FUC", city: "Fuchsia", name: "Ninjas", leader: "Koga", type: "Poison", div: "Kanto" },
  { abbr: "SAF", city: "Saffron", name: "Psychics", leader: "Sabrina", type: "Psychic", div: "Kanto" },
  { abbr: "CIN", city: "Cinnabar", name: "Volcanoes", leader: "Blaine", type: "Fire", div: "Kanto" },
  { abbr: "VIR", city: "Viridian", name: "Earthquakes", leader: "Giovanni", type: "Ground", div: "Kanto" },
  // Johto division (Indigo conference)
  { abbr: "VIO", city: "Violet", name: "Zephyrs", leader: "Falkner", type: "Flying", div: "Johto" },
  { abbr: "AZA", city: "Azalea", name: "Hives", leader: "Bugsy", type: "Bug", div: "Johto" },
  { abbr: "GLD", city: "Goldenrod", name: "Plains", leader: "Whitney", type: "Normal", div: "Johto" },
  { abbr: "ECR", city: "Ecruteak", name: "Phantoms", leader: "Morty", type: "Ghost", div: "Johto" },
  { abbr: "CIA", city: "Cianwood", name: "Storm", leader: "Chuck", type: "Fighting", div: "Johto" },
  { abbr: "OLI", city: "Olivine", name: "Mineral", leader: "Jasmine", type: "Steel", div: "Johto" },
  { abbr: "MAH", city: "Mahogany", name: "Glaciers", leader: "Pryce", type: "Ice", div: "Johto" },
  { abbr: "BLK", city: "Blackthorn", name: "Risers", leader: "Clair", type: "Dragon", div: "Johto" },
  // Hoenn division (Champion conference)
  { abbr: "RUS", city: "Rustboro", name: "Stones", leader: "Roxanne", type: "Rock", div: "Hoenn" },
  { abbr: "DEW", city: "Dewford", name: "Knuckles", leader: "Brawly", type: "Fighting", div: "Hoenn" },
  { abbr: "MAU", city: "Mauville", name: "Dynamos", leader: "Wattson", type: "Electric", div: "Hoenn" },
  { abbr: "LAV", city: "Lavaridge", name: "Heat", leader: "Flannery", type: "Fire", div: "Hoenn" },
  { abbr: "PET", city: "Petalburg", name: "Balance", leader: "Norman", type: "Normal", div: "Hoenn" },
  { abbr: "FOR", city: "Fortree", name: "Feathers", leader: "Winona", type: "Flying", div: "Hoenn" },
  { abbr: "MOS", city: "Mossdeep", name: "Minds", leader: "Tate & Liza", type: "Psychic", div: "Hoenn" },
  { abbr: "SOO", city: "Sootopolis", name: "Rain", leader: "Wallace", type: "Water", div: "Hoenn" },
  // Sinnoh division (Champion conference)
  { abbr: "ORE", city: "Oreburgh", name: "Coal", leader: "Roark", type: "Rock", div: "Sinnoh" },
  { abbr: "ETE", city: "Eterna", name: "Forest", leader: "Gardenia", type: "Grass", div: "Sinnoh" },
  { abbr: "VEI", city: "Veilstone", name: "Cobble", leader: "Maylene", type: "Fighting", div: "Sinnoh" },
  { abbr: "PAS", city: "Pastoria", name: "Fen", leader: "Crasher Wake", type: "Water", div: "Sinnoh" },
  { abbr: "HEA", city: "Hearthome", name: "Relics", leader: "Fantina", type: "Ghost", div: "Sinnoh" },
  { abbr: "CAN", city: "Canalave", name: "Mine", leader: "Byron", type: "Steel", div: "Sinnoh" },
  { abbr: "SNO", city: "Snowpoint", name: "Icicles", leader: "Candice", type: "Ice", div: "Sinnoh" },
  { abbr: "SUN", city: "Sunyshore", name: "Beacons", leader: "Volkner", type: "Electric", div: "Sinnoh" },
];
export const CONFERENCES = { Indigo: ["Kanto", "Johto"], Champion: ["Hoenn", "Sinnoh"] };

// Season and roster rules.
export const RULES = {
  gamesPerSeason: 82,
  playoffTeams: 16,
  playoffSeriesLength: 7,
  rosterMax: 23,
  minRoster: 20,
  dressed: { C: 4, W: 8, D: 6, G: 2 },
  maxLegendariesPerTeam: 1,
};

// Team strength: lines weighted by ice time, then the four weakest dressed
// spots drag the score down, as in All-22.
const LINE_WEIGHTS = {
  C: [0.35, 0.3, 0.2, 0.15],
  W: [0.35, 0.35, 0.3, 0.3, 0.2, 0.2, 0.15, 0.15],
  D: [0.4, 0.4, 0.33, 0.33, 0.27, 0.27],
  G: [1, 0],
};
export const teamRating = (lineup) => {
  // lineup: { C: [ovr...], W: [...], D: [...], G: [...] }, each sorted best first
  const part = (pos) => {
    const w = LINE_WEIGHTS[pos];
    let t = 0;
    let s = 0;
    w.forEach((wt, i) => {
      t += (lineup[pos][i] ?? 0) * wt;
      s += wt;
    });
    return s ? t / s : 0;
  };
  const raw = 0.3 * part("C") + 0.25 * part("W") + 0.25 * part("D") + 0.2 * part("G");
  const dressed = [...lineup.C.slice(0, 4), ...lineup.W.slice(0, 8), ...lineup.D.slice(0, 6), ...lineup.G.slice(0, 1)];
  const weakest = dressed.sort((a, b) => a - b).slice(0, 4);
  const gap = weakest.reduce((s, x) => s + Math.max(0, raw - x), 0) / 4;
  return Math.round(raw - 0.25 * gap);
};
