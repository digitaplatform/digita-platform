import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { type P, list, s, texts } from "@/blocks/marketing/shared";
import { MetadataDemoView } from "./view";

/**
 * One entity definition beside the API answer and the form generated from it. Every text of the
 * three panels comes from the props of the block that names the plugin, so each site and locale
 * shows its own definition; only the panel tags and the label of the whole come from the
 * translations. Without a definition there is nothing to show, so it draws nothing.
 */
export default function MetadataDemo({ props, locale }: { props?: P; locale: Locale }) {
  const definition = texts(props, "definition");
  if (!definition.length) return null;
  return (
    <MetadataDemoView
      label={t("metadataDemoLabel", locale)}
      tags={{ define: t("metadataDemoDefine", locale), api: t("metadataDemoApi", locale), form: t("metadataDemoForm", locale) }}
      generator={t("metadataDemoGenerator", locale)}
      definitionTitle={s(props, "definition_title")}
      definition={definition}
      apiTitle={s(props, "api_title")}
      api={texts(props, "api")}
      formTitle={s(props, "form_title")}
      fields={list(props, "fields").map((f) => ({ label: s(f, "label"), value: s(f, "value") }))}
      columns={texts(props, "columns")}
      rows={list(props, "rows").map((r) => texts(r, "cells"))}
      states={texts(props, "states")}
      state={s(props, "state")}
    />
  );
}
