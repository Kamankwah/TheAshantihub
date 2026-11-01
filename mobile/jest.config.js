module.exports = {
  preset: "jest-expo",
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
