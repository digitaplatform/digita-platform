// Types
export type {
  ApiResponse,
  ApiError,
  DeclaredClientError,
  ResponseMessage,
  PaginationMeta,
} from "./types/api-response.js";

export type {
  EntityDefinition,
  DatabaseTarget,
  FieldDefinition,
  FieldType,
  NamingConfig,
  NamingStrategy,
  IndexDefinition,
  ActionDefinition,
  ActionParamDef,
  EntityReportLink,
  LinkDefinition,
  StateDefinition,
  StatePermissionOverride,
  TransitionDefinition,
  HookDefinitions,
  SnapshotManifest,
  FlattenSpec,
  FreezeSpec,
  ScanResolveConfig,
  ScanResolveRule,
} from "./types/entity.js";

export { LAYOUT_FIELD_TYPES, NON_STORED_FIELD_TYPES, ROW_ID_FIELD } from "./types/entity.js";

export type { EntityPermission } from "./types/permissions.js";
export { PermissionAction, SYSTEM_ROLES } from "./types/permissions.js";

export { DocStatus } from "./types/docstatus.js";

export type { TimeSeriesConfig, PeriodCheckConfig, TreeConfig, SubmittedPatch, FormLayoutConfig } from "./types/entity.js";

// Cross-service authentication contract (digita-auth ⇄ digita-core / digita-post)
export type {
  TokenType,
  JwtAlgorithm,
  BaseTokenClaims,
  AccessTokenClaims,
  RefreshTokenClaims,
  PendingTokenClaims,
  DelegationScope,
  DelegationActor,
  DelegationTokenClaims,
  DelegationMintRequest,
  DelegationMintResponse,
  DelegationExchangeRequest,
  DelegationExchangeResponse,
  AnyTokenClaims,
  Jwk,
  JwksResponse,
  LoginRequest,
  LoginSuccessResponse,
  LoginPendingResponse,
  LoginResponse,
  RefreshRequest,
  TokenPairResponse,
  VerifyTwoFactorLoginRequest,
  LogoutRequest,
} from "./types/auth-contract.js";
export {
  TOKEN_TYPE,
  WELL_KNOWN_JWKS_PATH,
  TOKEN_TTL_REFERENCE,
  SESSION_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE_PATH,
  DELEGATION_MINT_PATH,
  DELEGATION_EXCHANGE_PATH,
} from "./types/auth-contract.js";

// Audience / tier model (ADR-A1…A5) — the 3-tier app-shell foundation.
export type { Audience, AudienceGrant, AudienceConfig, AudienceMap } from "./types/audience.js";
export { AUDIENCE_CLAIM, canEnterAudience } from "./types/audience.js";

export type {
  ViewDefinition,
  ViewSection,
  ViewSectionBase,
  LinkSection,
  ListSection,
  AggregateSection,
  ViewParamDefinition,
  ViewParamType,
  ViewSourceDefinition,
  ViewPermissionFallback,
  ViewFilterTuple,
  ExpandDefinition,
} from "./types/view.js";

// Report definition contract (digita-report)
export type {
  BandType,
  ReportObjectType,
  ReportPageSetup,
  ReportWatermark,
  ReportObjectStyle,
  ReportFormatSpec,
  ReportObjectBase,
  TextObject,
  ImageObject,
  LineObject,
  RectObject,
  BarcodeObject,
  CheckboxObject,
  TableCell,
  TableRow,
  TableObject,
  MatrixObject,
  GaugeObject,
  ReportObject,
  ReportBand,
  ReportLookup,
  ReportJoin,
  ReportJoinOn,
  ReportParam,
  ReportFilterTuple,
  ReportCollection,
  ReportDataConfig,
  ReportGroup,
  ReportDefinition,
} from "./types/report.js";
export { REPORT_SCHEMA_VERSION, PX_PER_MM } from "./types/report.js";
export { databaseApp, reportApps } from "./report-apps.js";
export type { ReportAppsInput } from "./report-apps.js";
export {
  safeCssColor,
  safeCssFontFamily,
  isAllowedBarcodeSymbology,
  allowedBarcodeSymbologies,
} from "./css-values.js";
export { countWrappedLines, type FontWidthTable } from "./text-metrics.js";
export type { ActionChunkResult, ActionChunkProgress } from "./types/jobs.js";
export { JOBS_CURSOR_PARAM, ENGINE_SERVICE_HEADERS } from "./types/jobs.js";
export type {
  ImportMode,
  ImportRowError,
  ImportReport,
  ImportRequestBody,
  ExportLinkFormat,
} from "./types/import-export.js";

export type {
  WorkspaceCardKind,
  NumberCard,
  ChartCard,
  ListCard,
  ShortcutCard,
  LinksCard,
  WorkspaceCard,
  WorkspaceDoc,
  ViewSectionData,
  ViewResult,
} from "./types/workspace.js";

// Constants
export {
  STORED_FIELD_TYPES,
  NUMERIC_FIELD_TYPES,
  TEXT_FIELD_TYPES,
  DATE_FIELD_TYPES,
  LINK_FIELD_TYPES,
  FILE_FIELD_TYPES,
  DATA_FORMAT_OPTIONS,
} from "./constants/field-types.js";
export type { DataFormatOption } from "./constants/field-types.js";

// Digita backend — collection + database name constants. Hand-maintained
// alongside `packages/backend/src/entities/*.entity.json`.
export { DIGITA } from "./digita-constants.js";
export type { DIGITACollection, DIGITADatabase } from "./digita-constants.js";

// Shared i18n mechanism — services supply their own locale bundles.
export { createTranslator } from "./i18n.js";
export type { Translator, LocaleBundle, LocaleMessages } from "./i18n.js";
