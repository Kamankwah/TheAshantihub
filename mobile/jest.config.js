module.exports = {
  preset: "jest-expo",
  forceExit: true, // react-query and animation timers must not hold the test process open
  setupFiles: ["<rootDir>/jest.setup.js"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
