import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { FieldType } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';

/**
 * fieldtype → lazy control Unit. Grows per build step (F3 core → F4 flat → F8
 * Table/Link/Attach). A type with no loader resolves to `unsupported` → the loud
 * UnsupportedControl, NEVER a silent text-box fallback (F2).
 */

type ControlComponent = ComponentType<FieldControlProps>;
type Loader = () => Promise<{ default: ControlComponent }>;

const LOADERS: Partial<Record<FieldType, Loader>> = {
  // Text-like
  Data: () => import('@/controls/DataControl'),
  Text: () => import('@/controls/TextControl'),
  SmallText: () => import('@/controls/TextControl'),
  TextEditor: () => import('@/controls/TextControl'),
  Code: () => import('@/controls/TextControl'),
  Markdown: () => import('@/controls/TextControl'),
  Password: () => import('@/controls/PasswordControl'),
  Phone: () => import('@/controls/PhoneControl'),
  Barcode: () => import('@/controls/BarcodeControl'),
  // Numeric
  Int: () => import('@/controls/IntControl'),
  Float: () => import('@/controls/FloatControl'),
  Currency: () => import('@/controls/CurrencyControl'),
  Percent: () => import('@/controls/PercentControl'),
  Rating: () => import('@/controls/RatingControl'),
  Duration: () => import('@/controls/DurationControl'),
  // Boolean / choice
  Check: () => import('@/controls/CheckControl'),
  Select: () => import('@/controls/SelectControl'),
  Tag: () => import('@/controls/TagControl'),
  // Date / time
  Date: () => import('@/controls/DateControl'),
  Datetime: () => import('@/controls/DatetimeControl'),
  Time: () => import('@/controls/TimeControl'),
  // Misc
  Color: () => import('@/controls/ColorControl'),
  JSON: () => import('@/controls/JSONControl'),
  Geolocation: () => import('@/controls/GeolocationControl'),
  Signature: () => import('@/controls/SignatureControl'),
  Image: () => import('@/controls/ImageControl'),
  ReadOnly: () => import('@/controls/ReadOnlyControl'),
  // Relational / file
  Link: () => import('@/controls/LinkControl'),
  Table: () => import('@/controls/TableControl'),
  Attach: () => import('@/controls/AttachControl'),
  AttachImage: () => import('@/controls/AttachImageControl'),
};

const cache = new Map<FieldType, LazyExoticComponent<ControlComponent>>();

export type ControlResolution =
  | { kind: 'control'; Component: LazyExoticComponent<ControlComponent> }
  | { kind: 'unsupported'; fieldtype: string; reason: string };

export function resolveControl(fieldtype: FieldType): ControlResolution {
  if (LAYOUT_FIELD_TYPES.includes(fieldtype)) {
    return {
      kind: 'unsupported',
      fieldtype,
      reason: `layout type "${fieldtype}" reached the control registry — layout-parser bug`,
    };
  }
  const loader = LOADERS[fieldtype];
  if (!loader) {
    return { kind: 'unsupported', fieldtype, reason: `no control mapped for field type "${fieldtype}"` };
  }
  let C = cache.get(fieldtype);
  if (!C) {
    C = lazy(loader);
    cache.set(fieldtype, C);
  }
  return { kind: 'control', Component: C };
}
