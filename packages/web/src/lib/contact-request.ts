/** What a contact request is about: the ContactRequest `topic` options. The sheet offers them and
 *  the contact route accepts only them. */
export const CONTACT_TOPICS = ["contact", "trial", "early_access"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];
