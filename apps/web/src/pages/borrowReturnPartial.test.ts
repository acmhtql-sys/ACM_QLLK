import { describe, expect, it } from 'vitest';
import { buildReturnItems } from './borrowReturnPartial';

const details = [
  { id: 'detail-led', quantity: 4, returnedQuantity: 0 },
  { id: 'detail-arduino', quantity: 2, returnedQuantity: 1 },
];

describe('partial return payload validation', () => {
  it('only returns rows with positive quantities', () => {
    expect(buildReturnItems(details, {
      'detail-led': { quantity: '2', condition: 'GOOD' },
      'detail-arduino': { quantity: '0', condition: 'LOST' },
    })).toEqual([
      {
        borrowDetailId: 'detail-led',
        returnedQuantity: 2,
        condition: 'GOOD',
        notes: undefined,
      },
    ]);
  });

  it('supports a remaining quantity of one', () => {
    expect(buildReturnItems(details, {
      'detail-arduino': { quantity: '1', condition: 'DAMAGED' },
    })[0]).toMatchObject({
      borrowDetailId: 'detail-arduino',
      returnedQuantity: 1,
      condition: 'DAMAGED',
    });
  });

  it('supports GOOD, DAMAGED and LOST in separate return transactions', () => {
    const first = buildReturnItems(
      [{ id: 'd1', quantity: 4, returnedQuantity: 0 }],
      { d1: { quantity: '2', condition: 'GOOD' } }
    );

    const second = buildReturnItems(
      [{ id: 'd1', quantity: 4, returnedQuantity: 2 }],
      { d1: { quantity: '1', condition: 'DAMAGED' } }
    );

    const third = buildReturnItems(
      [{ id: 'd1', quantity: 4, returnedQuantity: 3 }],
      { d1: { quantity: '1', condition: 'LOST' } }
    );

    expect(first[0].returnedQuantity).toBe(2);
    expect(second[0].condition).toBe('DAMAGED');
    expect(third[0].condition).toBe('LOST');
  });

  it('rejects quantities exceeding the remaining amount', () => {
    expect(() => buildReturnItems(details, {
      'detail-arduino': { quantity: '2', condition: 'GOOD' },
    })).toThrow();
  });

  it('rejects negative and fractional quantities', () => {
    for (const quantity of ['-1', '1.5', 'abc', '']) {
      expect(() => buildReturnItems(details, {
        'detail-led': { quantity, condition: 'GOOD' },
      })).toThrow();
    }
  });

  it('rejects a return with no selected quantity', () => {
    expect(() => buildReturnItems(details, {})).toThrow();
  });

  it('rejects duplicate borrow detail identifiers', () => {
    expect(() => buildReturnItems(
      [details[0], details[0]],
      { 'detail-led': { quantity: '1', condition: 'GOOD' } }
    )).toThrow();
  });

  it('preserves a return note without inventing item rows', () => {
    expect(buildReturnItems(details, {
      'detail-led': { quantity: '1', condition: 'LOST' },
    }, 'Kiểm tra tại Lab')[0]).toMatchObject({
      condition: 'LOST',
      notes: 'Kiểm tra tại Lab',
    });
  });
});
