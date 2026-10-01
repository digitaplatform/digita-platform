import { buttonAttributes } from "@digitaplatform/components";
import { type P, Section, s, texts } from "./shared";

/** Where and how to reach the company. The booking button appears only once a booking link exists. */
export function ContactDetails({ props }: { props?: P }) {
  const address = texts(props, "address");
  if (!address.length) return null;
  const email = s(props, "email");
  const phone = s(props, "phone");
  const bookingUrl = s(props, "booking_url");
  const bookingLabel = s(props, "booking_label");
  return (
    <Section heading={s(props, "heading")} lede={s(props, "body")}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <address className="flex flex-col gap-1 not-italic text-textMain">
          {address.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
          {email && (
            <a href={`mailto:${email}`} className="mt-3 text-primaryText hover:underline">
              {email}
            </a>
          )}
          {phone && (
            <a href={`tel:${phone.replace(/\s+/g, "")}`} className="text-primaryText hover:underline">
              {phone}
            </a>
          )}
        </address>
        {bookingUrl && bookingLabel && (
          <a href={bookingUrl} {...buttonAttributes({ size: "lg" })}>
            {bookingLabel}
          </a>
        )}
      </div>
    </Section>
  );
}
