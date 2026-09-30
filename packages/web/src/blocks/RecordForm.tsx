import { getConfig } from "@/config/env";
import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { type P, Section, s } from "./marketing/shared";
import { readRecordFormFields } from "./record-form";
import { RecordFormFields } from "./RecordFormFields";

/**
 * A form that creates one record of the entity its props name, through the Guest create of the
 * engine that holds it (src/app/api/record/route.ts). It draws nothing without an entity or a
 * visible field, and nothing when it names a tenant app whose engine the site does not know
 * (ENGINE_URLS), whose posts would find no engine. A form whose entity or fields the Guest row does
 * not open still draws, and the route refuses its posts with 403.
 */
export function RecordForm({ props, locale }: { props?: P; locale: Locale }) {
  const entity = s(props, "entity");
  const app = s(props, "app");
  const fields = readRecordFormFields(props);
  if (!entity || !fields.some((field) => field.type !== "hidden")) return null;
  if (app && !getConfig().engineUrls.has(app)) return null;
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
        renderedAt={Date.now()}
        locale={locale}
      />
    </Section>
  );
}
