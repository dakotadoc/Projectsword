// Time-period filtering, so nothing shows up in a year where it doesn't belong.
//
// Any entry in a data list may carry optional "from" and "to" years
// (inclusive). An entry without them fits every year. Plain strings
// (e.g. in name lists) fit every year; to date a name, write it as
// { "name": "Haruto", "from": 1995 }.
//
// Always filter BEFORE rolling, so the seeded RNG sees the same list
// for the same year.

export function fitsYear(entry, year) {
  if (typeof entry !== 'object' || entry === null) return true;
  if (Number.isFinite(entry.from) && year < entry.from) return false;
  if (Number.isFinite(entry.to) && year > entry.to) return false;
  return true;
}

export function availableIn(list, year) {
  return list.filter((entry) => fitsYear(entry, year));
}

// A name-list entry is either "Name" or { name, from?, to? }.
// Family names whose form depends on sex (e.g. Czech Novák / Nováková)
// are written { "male": "Novák", "female": "Nováková" }.
export function entryName(entry, sex) {
  if (typeof entry === 'string') return entry;
  return entry.name ?? entry[sex];
}
