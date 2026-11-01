module.exports = {
  preset: "jest-expo",
  resolver: "react-native-reanimated/jest/resolver",
  testTimeout: 30000, // a cold transform cache makes the first test in a file slow
  forceExit: true, // react-query and animation timers must not hold the test process open
  setupFiles: ["<rootDir>/jest.setup.js"],
  setupFilesAfterEnv: ["<rootDir>/jest.after.js"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
