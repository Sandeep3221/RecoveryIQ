export const recoveryPolicy = Object.freeze({
  version: "policy-v1",
  maxNudgesPerCase: 2,
  minimumNudgeCooldownHours: 24,
  maxCaseAgeHours: 168,
  maxUnknownFailuresBeforeStop: 2,
});

