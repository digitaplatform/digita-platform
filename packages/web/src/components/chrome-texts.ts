import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import type { ContactSheetTexts } from "./ContactSheet";
import type { DesignSwitcherTexts } from "./DesignSwitcher";

/**
 * The texts of the chrome's client components, in the page's locale. `t` reads the site's texts
 * from the server's disk, so the server builds each component's texts and hands them over as one
 * prop. Every key is written out so the translations test sees it.
 */
export function contactSheetTexts(locale: Locale): ContactSheetTexts {
  return {
    title: t("contactTitle", locale),
    heading: t("contactHeading", locale),
    close: t("contactClose", locale),
    lede: t("contactLede", locale),
    book: t("contactBook", locale),
    orWrite: t("contactOrWrite", locale),
    name: t("contactName", locale),
    email: t("contactEmail", locale),
    company: t("contactCompany", locale),
    topic: t("contactTopic", locale),
    message: t("contactMessage", locale),
    messagePlaceholder: t("contactMessagePlaceholder", locale),
    send: t("contactSend", locale),
    sent: t("contactSent", locale),
    failed: t("contactFailed", locale),
    invalidField: t("contactInvalidField", locale),
    unavailable: t("contactUnavailable", locale),
    tooMany: t("contactTooMany", locale),
    privacyNote: t("contactPrivacyNote", locale),
    privacy: t("contactPrivacy", locale),
    topics: {
      contact: t("topicContact", locale),
      trial: t("topicTrial", locale),
      early_access: t("topicEarlyAccess", locale),
    },
  };
}

export function designSwitcherTexts(locale: Locale): DesignSwitcherTexts {
  return {
    title: t("designBandTitle", locale),
    note: t("designBandNote", locale),
    notBundled: t("designNotBundled", locale),
    refused: t("designRefused", locale),
  };
}
