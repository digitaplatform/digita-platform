import { describe, it, expect } from 'vitest';
import { tid } from '@/lib/testid';

describe('tid — meta-derived test hooks', () => {
  it('page: canonical id + dims, with/without entity', () => {
    expect(tid.page('list', 'Widget')).toEqual({
      'data-testid': 'page:list:Widget',
      'data-page': 'list',
      'data-entity': 'Widget',
    });
    expect(tid.page('dashboard')).toEqual({ 'data-testid': 'page:dashboard', 'data-page': 'dashboard' });
  });

  it('field: addressable by entity:field + carries entity/field/control dims', () => {
    expect(tid.field('Widget', 'code', 'Data')).toEqual({
      'data-testid': 'field:Widget:code',
      'data-entity': 'Widget',
      'data-field': 'code',
      'data-control': 'Data',
    });
  });

  it('row: id-addressable + generic list-row component + row-id dim', () => {
    expect(tid.row('Widget', 'W-1')).toEqual({
      'data-testid': 'row:W-1',
      'data-component': 'list-row',
      'data-entity': 'Widget',
      'data-row-id': 'W-1',
    });
  });

  it('col / region / action / transition / component', () => {
    expect(tid.col('display_name')).toEqual({ 'data-testid': 'col:display_name', 'data-field': 'display_name' });
    expect(tid.region('nav')).toEqual({ 'data-testid': 'region:nav', 'data-region': 'nav' });
    expect(tid.action('save')).toEqual({ 'data-testid': 'action:save', 'data-action': 'save' });
    expect(tid.transition('confirmed')).toEqual({ 'data-testid': 'transition:confirmed', 'data-action': 'confirmed' });
    expect(tid.component('list-table', 'Widget')).toEqual({
      'data-testid': 'list-table',
      'data-component': 'list-table',
      'data-entity': 'Widget',
    });
  });
});
