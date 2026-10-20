// Every player is one individual Pokémon: a level, IVs, a nature and a
// nickname. Its six stats come from the games' formulas, and those stats feed
// the hockey skill recipes in ratings.js.

import { skillsFromStats } from "./ratings.js";
import { typicalLevel } from "./growth.js";

export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_NAMES = { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };

// Each nature raises one stat by 10% and lowers another by 10%. Five are neutral.
export const NATURES = {
  Hardy: null,
  Lonely: ["atk", "def"],
  Brave: ["atk", "spe"],
  Adamant: ["atk", "spa"],
  Naughty: ["atk", "spd"],
  Bold: ["def", "atk"],
  Docile: null,
  Relaxed: ["def", "spe"],
  Impish: ["def", "spa"],
  Lax: ["def", "spd"],
  Timid: ["spe", "atk"],
  Hasty: ["spe", "def"],
  Serious: null,
  Jolly: ["spe", "spa"],
  Naive: ["spe", "spd"],
  Modest: ["spa", "atk"],
  Mild: ["spa", "def"],
  Quiet: ["spa", "spe"],
  Bashful: null,
  Rash: ["spa", "spd"],
  Calm: ["spd", "atk"],
  Gentle: ["spd", "def"],
  Sassy: ["spd", "spe"],
  Careful: ["spd", "spa"],
  Quirky: null,
};

export const natureMultiplier = (nature, stat) => {
  const n = NATURES[nature];
  if (!n) return 1;
  return stat === n[0] ? 1.1 : stat === n[1] ? 0.9 : 1;
};

// The games' stat formulas. EVs are always 0 in this league, but the formula
// takes them so it can be checked against real in-game numbers.
export const statValue = (stat, base, iv, level, nature, ev = 0) => {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (stat === "hp") return core + level + 10;
  return Math.floor((core + 5) * natureMultiplier(nature, stat));
};

// Past his peak age a player wears down: Speed fades at twice the rate of his
// other stats. Wear is the share his other stats have lost (see aging.js).
export const wearFactor = (stat, wear = 0) => 1 - (stat === "spe" ? 2 : 1) * wear;

export const inGameStats = (species, p) =>
  Object.fromEntries(
    STAT_KEYS.map((k) => {
      const v = statValue(k, species.bs[k], p.ivs[k], p.level, p.nature);
      return [k, p.wear ? Math.round(v * wearFactor(k, p.wear)) : v];
    }),
  );

// The skill recipes are tuned in base-stat units. A stat at this level, with
// average IVs and a neutral nature, converts back to exactly its base stat, so
// a level 50 player rates the same as his species did before levels existed.
export const REFERENCE_LEVEL = 50;
const IV_AVERAGE = 15.5;

export const toBaseScale = (stat, value, level) => {
  const core = stat === "hp" ? value - level - 10 : value - 5;
  return ((core * 100) / REFERENCE_LEVEL - IV_AVERAGE) / 2;
};

// Levels past 70 count at half rate for skills, so a level 100 legend doesn't
// break the league (the card still shows his real stats).
export const SKILL_LEVEL_SOFTEN = 70;
const skillLevel = (level) =>
  level <= SKILL_LEVEL_SOFTEN ? level : SKILL_LEVEL_SOFTEN + (level - SKILL_LEVEL_SOFTEN) / 2;

export const playerSkills = (species, p) => {
  const level = skillLevel(p.level);
  const stats = inGameStats(species, { ...p, level });
  const scaled = Object.fromEntries(STAT_KEYS.map((k) => [k, toBaseScale(k, stats[k], level)]));
  return skillsFromStats(scaled, species.h, species.w, species.types);
};

// The in-game judge's words for an IV. Scouting shows these, never the number.
export const IV_JUDGE = [
  { min: 31, max: 31, label: "Best" },
  { min: 30, max: 30, label: "Fantastic" },
  { min: 26, max: 29, label: "Very good" },
  { min: 16, max: 25, label: "Pretty good" },
  { min: 1, max: 15, label: "Decent" },
  { min: 0, max: 0, label: "No good" },
];
export const judgeIv = (iv) => IV_JUDGE.find((j) => iv >= j.min);

// Species whose method doesn't map to hockey yet (a move, a held item, a
// special condition) evolve at this level.
export const FALLBACK_EVOLUTION_LEVEL = 36;

// How a species is reached from its prevo: by level, by stone, by friendship
// or by trade. Null for a species that doesn't evolve from anything.
export const evolutionMethod = (species) => {
  if (!species.evoType) return null;
  if (species.evoType === "trade") return { kind: "trade" };
  if (species.evoType === "useItem") return { kind: "stone", item: species.evoItem };
  if (species.evoType === "levelFriendship") return { kind: "friendship" };
  return { kind: "level", level: species.evoLevel ?? FALLBACK_EVOLUTION_LEVEL };
};

const levelGate = (species) => {
  const m = species && evolutionMethod(species);
  return m?.kind === "level" ? m.level : null;
};

// The level a species evolves at from its prevo, and the lowest level at which
// it evolves into something else. Either is null when no level gates it.
export const evolutionLevels = (species, byId) => {
  const next = (species.evos ?? []).map((id) => levelGate(byId[id])).filter((x) => x != null);
  return { from: levelGate(species), to: next.length ? Math.min(...next) : null };
};

// Starting level for a player in a new league: about where a typical player
// of his age would have grown to. A species is never below the level it
// evolved at, and never at or past the level where it would evolve again.
export const startingLevel = (species, age, byId, rng) => {
  const { from, to } = evolutionLevels(species, byId);
  let level = Math.round(typicalLevel(age) + rng.normal(0, 3));
  if (to != null) level = Math.min(level, to - rng.int(1, 10));
  if (from != null) level = Math.max(level, from);
  return Math.max(2, Math.min(100, level));
};

const GENERAL_NICKNAMES = [
  "Ace",
  "Bandit",
  "Biscuit",
  "Bones",
  "Boomer",
  "Buzz",
  "Captain",
  "Chief",
  "Clutch",
  "Cookie",
  "Dash",
  "Dizzy",
  "Doc",
  "Dynamo",
  "Flash",
  "Gizmo",
  "Goose",
  "Hammer",
  "Hollywood",
  "Ike",
  "Jet",
  "Jumbo",
  "Lucky",
  "Mayhem",
  "Moose",
  "Noodle",
  "Pepper",
  "Pickles",
  "Rocket",
  "Rookie",
  "Scooter",
  "Sparky",
  "Spud",
  "Tank",
  "Tiny",
  "Turbo",
  "Waffles",
  "Wheels",
  "Wizard",
  "Ziggy",
];

const TYPE_NICKNAMES = {
  Normal: ["Plain Jane", "Buddy", "Scruffy", "Patches", "Chester"],
  Fire: ["Blaze", "Torch", "Ember", "Scorch", "Cinder"],
  Water: ["Splash", "Puddles", "Tsunami", "Captain Wet", "Drizzle"],
  Grass: ["Sprout", "Mossy", "Clover", "Thorn", "Bramble"],
  Electric: ["Volt", "Zapper", "Static", "Short Circuit", "Amp"],
  Ice: ["Frosty", "Snowball", "Icicle", "Chill", "Blizzard"],
  Fighting: ["Knuckles", "Brawler", "Punchy", "Champ", "Haymaker"],
  Poison: ["Toxic", "Venom", "Stinger", "Sludge", "Fang"],
  Ground: ["Mudslide", "Rumble", "Dusty", "Quake", "Digger"],
  Flying: ["Wings", "Gusty", "Sky", "Tailwind", "Swoop"],
  Psychic: ["Mindbender", "Psy", "Professor", "Oracle", "Hypno"],
  Bug: ["Buggy", "Skitter", "Stingray", "Beetle", "Antsy"],
  Rock: ["Rocky", "Boulder", "Pebbles", "The Wall", "Granite"],
  Ghost: ["Spooky", "Phantom", "Casper", "Shadow", "Boo"],
  Dragon: ["Scales", "Drake", "Wyvern", "Fireball", "Big Lizard"],
  Dark: ["Midnight", "Sneaky", "Rascal", "Shade", "Nightshift"],
  Steel: ["Ironside", "Rivets", "Chrome", "Bolt", "Tin Man"],
  Fairy: ["Twinkle", "Pixie", "Glitter", "Sugar", "Dreamy"],
};

export const pickNickname = (species, rng) =>
  rng.chance(0.6) ? rng.pick(TYPE_NICKNAMES[rng.pick(species.types)]) : rng.pick(GENERAL_NICKNAMES);

// Hatches one individual of a species.
export const hatch = (species, { level, rng }) => ({
  level,
  ivs: Object.fromEntries(STAT_KEYS.map((k) => [k, rng.int(0, 31)])),
  nature: rng.pick(Object.keys(NATURES)),
  nickname: pickNickname(species, rng),
});
