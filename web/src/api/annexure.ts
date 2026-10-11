/**
 * NCVET:FR Annexure II and Annexure IV.
 * Stored strings from SCHEMA §1.5 and §1.6. Printed abbreviations stay as printed.
 */

export const SECTOR_NAMES = [
  "Aerospace and Aviation",
  "Automotive",
  "Agriculture",
  "Apparel",
  "Beauty & Wellness",
  "BFSI",
  "Capital goods",
  "Chemicals and Petrochemicals",
  "Construction",
  "Domestic Worker",
  "Education, Training & Research",
  "Electronics",
  "Environmental Science",
  "Food",
  "Gems/Jewel",
  "Glass & Ceramics",
  "Handicrafts",
  "Healthcare",
  "Hydrocarbon",
  "Infrastructure",
  "Iron & Steel",
  "IT-ITeS",
  "Judiciary",
  "Leather",
  "Legal Services",
  "Legislators",
  "Life Sciences",
  "Media & Entertainment",
  "Mining",
  "Musical Inst.",
  "Office Admin",
  "Optical Products",
  "Org. Retail",
  "Paints & Coatings",
  "Paper & paper products",
  "Plumbing",
  "Postal",
  "Power",
  "Printing",
  "Public Admin",
  "Pvt. Security",
  "PwD",
  "Railways",
  "Real Estate",
  "Religious Prof.",
  "Rubber",
  "Shipping",
  "Sports",
  "Telecom",
  "Textile",
  "Tobacco",
  "Tourism & Hospitality",
  "Transportation, Logistics and Warehousing",
  "Unorg. Sector",
  "Water Supply",
  "Wood & Carp.",
  "Instrumentation",
  "Green Jobs",
  "Management",
] as const;

export type SectorName = (typeof SECTOR_NAMES)[number];

const SECTOR_SET: ReadonlySet<string> = new Set(SECTOR_NAMES);

export function isSectorName(value: string): value is SectorName {
  return SECTOR_SET.has(value);
}

export const STATE_NAMES = [
  "Andaman and Nicobar Islands",
  "Lakshadweep",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Ladakh",
  "Chandigarh",
  "Puducherry",
  "Sikkim",
  "Mizoram",
  "Goa",
  "Arunachal Pradesh",
  "Nagaland",
  "Manipur",
  "Meghalaya",
  "Tripura",
  "Himachal",
  "Uttarakhand",
  "J and K",
  "NCT of Delhi",
  "Chattisgarh",
  "Telangana",
  "Haryana",
  "Kerala",
  "Punjab",
  "Jharkhand",
  "Assam",
  "Orissa",
  "Gujarat",
  "Karnataka",
  "Rajasthan",
  "Tamil Nadu",
  "Madhya Pradesh",
  "Andhra Pradesh",
  "Bihar",
  "West Bengal",
  "Maharashtra",
  "Uttar Pradesh",
] as const;

export type StateName = (typeof STATE_NAMES)[number];

const STATE_SET: ReadonlySet<string> = new Set(STATE_NAMES);

export function isStateName(value: string): value is StateName {
  return STATE_SET.has(value);
}
