import '@testing-library/jest-dom/vitest';

// jsdom implements neither layout nor scrolling — stub the two APIs the kit
// uses so components can call them idiomatically.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
