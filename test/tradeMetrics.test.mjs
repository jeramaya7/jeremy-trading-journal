import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePnl,
  calculateRiskDollars,
  calculateRiskPercent,
  calculateRMultiple,
  optionalNumber,
} from '../src/tradeMetrics.js';

test('calculates risk dollars, risk percent, and R multiple for long trades', () => {
  const trade = {
    direction: 'Long',
    entry: 100,
    exit: 110,
    size: 10,
    stopLoss: 95,
    accountSize: 10000,
    fees: 0,
  };

  assert.equal(calculatePnl(trade), 100);
  assert.equal(calculateRiskDollars(trade), 50);
  assert.equal(calculateRiskPercent(trade), 0.5);
  assert.equal(calculateRMultiple(trade), 2);
});

test('calculates risk dollars, risk percent, and R multiple for short trades', () => {
  const trade = {
    direction: 'Short',
    entry: 100,
    exit: 90,
    size: 5,
    stopLoss: 104,
    accountSize: 20000,
    fees: 10,
  };

  assert.equal(calculatePnl(trade), 40);
  assert.equal(calculateRiskDollars(trade), 20);
  assert.equal(calculateRiskPercent(trade), 0.1);
  assert.equal(calculateRMultiple(trade), 2);
});

test('keeps existing trades working when optional risk fields are blank', () => {
  const existingTrade = {
    direction: 'Long',
    entry: 100,
    exit: 101,
    size: 2,
    fees: 0,
  };

  assert.equal(optionalNumber(''), null);
  assert.equal(calculatePnl(existingTrade), 2);
  assert.equal(calculateRiskDollars(existingTrade), null);
  assert.equal(calculateRiskPercent(existingTrade), null);
  assert.equal(calculateRMultiple(existingTrade), null);
});
