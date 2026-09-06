#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor({
    attrs = {},
    disabled = false,
    type = '',
    innerText = '',
    textContent = '',
    rect = { top: 720, bottom: 760, left: 700, right: 740, width: 40, height: 40 },
    icon = null
  } = {}) {
    this.attrs = attrs;
    this.disabled = disabled;
    this.type = type;
    this.innerText = innerText;
    this.textContent = textContent || innerText;
    this.rect = rect;
    this.icon = icon;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  querySelector(selector) {
    if (selector.includes('mat-icon') || selector.includes('svg')) return this.icon;
    return null;
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function loadHelpers() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Event: class Event {},
    InputEvent: class InputEvent {},
    MouseEvent: class MouseEvent {},
    PointerEvent: class PointerEvent {},
    KeyboardEvent: class KeyboardEvent {},
    document: {
      createRange() {
        return { selectNodeContents() {} };
      },
      createElement() {
        return { textContent: '', innerHTML: '' };
      },
      querySelectorAll() {
        return [];
      },
      contains() {
        return true;
      }
    },
    window: {
      innerHeight: 900,
      getComputedStyle() {
        return { display: 'block', visibility: 'visible', opacity: '1' };
      },
      getSelection() {
        return { removeAllRanges() {}, addRange() {} };
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../content/dom-utils.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'dom-utils.js' });
  return sandbox.window.AIPanelDom;
}

const helpers = loadHelpers();
const scoreSubmitButton = helpers._test.scoreSubmitButton;

const input = new FakeElement({
  rect: { top: 700, bottom: 760, left: 120, right: 680, width: 560, height: 60 }
});

const unlabeledNearInput = new FakeElement({
  rect: { top: 708, bottom: 748, left: 700, right: 740, width: 40, height: 40 }
});
assert.strictEqual(
  scoreSubmitButton(unlabeledNearInput, input, /(send|submit|run)/i, undefined, false),
  -Infinity,
  'Gemini should not treat unlabeled nearby icon buttons as send buttons'
);
assert(
  scoreSubmitButton(unlabeledNearInput, input, /(send|submit|run)/i, undefined, true) > 15,
  'Claude can still use the legacy unlabeled nearby icon fallback'
);

const matIconSend = new FakeElement({
  icon: new FakeElement({ attrs: { 'data-mat-icon-name': 'send' } }),
  rect: { top: 708, bottom: 748, left: 700, right: 740, width: 40, height: 40 }
});
assert(
  scoreSubmitButton(matIconSend, input, /(send|submit|run)/i, undefined, false) > 70,
  'Gemini send buttons exposed only through a child mat-icon should be recognized'
);

const disabledSend = new FakeElement({
  attrs: { 'aria-label': 'Send message' },
  disabled: true,
  rect: { top: 708, bottom: 748, left: 700, right: 740, width: 40, height: 40 }
});
const enabledSend = new FakeElement({
  attrs: { 'aria-label': 'Send message' },
  rect: { top: 708, bottom: 748, left: 700, right: 740, width: 40, height: 40 }
});
assert(
  scoreSubmitButton(enabledSend, input, /(send|submit|run)/i) >
    scoreSubmitButton(disabledSend, input, /(send|submit|run)/i),
  'enabled send buttons should score higher than disabled send buttons'
);

(async () => {
  const { verifySubmissionStarted } = helpers._test;

  // verifySubmissionStarted P2 tightened: "button disabled/removed" alone no
  // longer counts as submitted — hidden-tab UI re-renders replace the button
  // node on text writes, which faked "Message sent" while the text sat unsent
  // (doubao/gemini 实测). The button signal now requires the input to be
  // cleared as well; the old Gemini special case is covered by the activate-
  // and-retry path (real send clears the Quill editor).
  const stillTyped = new FakeElement({ innerText: 'hello world' });
  const disabledAfterClick = new FakeElement({ attrs: { 'aria-label': 'Send' }, disabled: true });
  await assert.rejects(
    verifySubmissionStarted(stillTyped, 'hello world', { verifyMaxWait: 150 }, disabledAfterClick),
    /Submit did not start/,
    'button disabled with text still present must NOT count as submitted'
  );

  // Combined signal: button disabled AND input cleared = real send.
  const clearedInput = new FakeElement({ innerText: '' });
  assert.strictEqual(
    await verifySubmissionStarted(clearedInput, 'hello world', {}, disabledAfterClick),
    true,
    'button disabled + input cleared should count as submitted'
  );

  // Without the disabled signal and with unchanged text, it must keep polling
  // and finally report that submission did not start.
  const enabledButton = new FakeElement({ attrs: { 'aria-label': 'Send' } });
  await assert.rejects(
    verifySubmissionStarted(stillTyped, 'hello world', { verifyMaxWait: 150 }, enabledButton),
    /Submit did not start/,
    'unchanged text with enabled button should time out'
  );

  console.log('dom-utils tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
