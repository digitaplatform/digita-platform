import {
  Plus,
  Pencil,
  Check,
  X,
  Trash2,
  Download,
  Upload,
  Send,
  Copy,
  Printer,
  RefreshCw,
  FileText,
  Mail,
  ExternalLink,
  Play,
  Ban,
  CircleCheck,
  CircleX,
  Eye,
  Star,
  Link2,
  Lock,
  Unlock,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curated name → lucide-icon registry for icons declared in entity JSON
 * (ActionDefinition.icon, and reusable for other meta-declared icons). A bounded
 * allow-list — NOT a dynamic import of arbitrary lucide names — so entity authors
 * pick from a known, on-brand set and an unknown name degrades to label-only.
 * Several common synonyms map to the same glyph to match the shared action
 * vocabulary (Check = save/confirm, X = cancel, Trash2 = delete, …).
 */
const ICONS: Record<string, LucideIcon> = {
  plus: Plus,
  new: Plus,
  add: Plus,
  edit: Pencil,
  pencil: Pencil,
  check: Check,
  confirm: Check,
  approve: CircleCheck,
  x: X,
  cancel: X,
  close: X,
  reject: CircleX,
  trash: Trash2,
  delete: Trash2,
  download: Download,
  export: Download,
  upload: Upload,
  import: Upload,
  send: Send,
  submit: Send,
  copy: Copy,
  duplicate: Copy,
  print: Printer,
  printer: Printer,
  refresh: RefreshCw,
  reload: RefreshCw,
  sync: RefreshCw,
  file: FileText,
  document: FileText,
  mail: Mail,
  email: Mail,
  link: Link2,
  external: ExternalLink,
  open: ExternalLink,
  view: Eye,
  star: Star,
  default: Star,
  play: Play,
  run: Play,
  ban: Ban,
  lock: Lock,
  unlock: Unlock,
};

/** Resolve an entity-declared icon name to a lucide component (undefined if unknown). */
export function resolveIcon(name?: string): LucideIcon | undefined {
  if (!name) return undefined;
  return ICONS[name.toLowerCase()];
}
