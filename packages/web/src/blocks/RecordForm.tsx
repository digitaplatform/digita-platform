import { getConfig, requiredFormSigningKey } from "@/config/env";
import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { signForm } from "@/lib/form-signature";
import { type P, Section, s } from "./marketing/shared";
import { readRecordFormFields } from "./record-form";
import { RecordFormFields } from "./RecordFormFields";

/**
 * A form that creates one record of the entity its props name, through the Guest create of the
 * engine that holds it (src/app/api/record/route.ts). It draws nothing without an entity or a
 * visible field, and nothing when it names a tenant app whose engine the site does not know
 * (ENGINE_URLS), whose posts would find no engine. A form whose entity or fields the Guest row does
 * not open still draws, and the route refuses its posts with 403. The form carries a signature of
 * what it was rendered for, so the route takes only posts of a form the site placed; a page that
 * places one on a renderer without the signing key fails, as a missing setting does.
 */
export function RecordForm({ props, locale }: { props?: P; locale: Locale }) {
  const entity = s(props, "entity");
  const app = s(props, "app");
  const fields = readRecordFormFields(props);
  if (!entity || !fields.some((field) => field.type !== "hidden")) return null;
  if (app && !getConfig().engineUrls.has(app)) return null;
  const renderedAt = Date.now();
  const signature = signForm(requiredFormSigningKey(), { app, entity, fields: fields.map((field) => field.name), renderedAt });
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <RecordFormFields
        app={app}
        entity={entity}
        fields={fields}
        texts={{
          send: s(props, "send_label") || t("recordFormSend", locale),
          sent: s(props, "thanks") || t("recordFormSent", locale),
          failed: t("recordFormFailed", locale),
          invalidField: t("recordFormInvalidField", locale),
          unavailable: t("recordFormUnavailable", locale),
          tooMany: t("recordFormTooMany", locale),
        }}
        renderedAt={renderedAt}
        signature={signature}
        locale={locale}
      />
    </Section>
  );
}
