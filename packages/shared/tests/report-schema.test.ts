// The report definition schema, published so a catalog checks its report files before a tenant
// boots them: the same rules refuse a file in the catalog's check that the report service refuses.
import { describe, expect, it } from "vitest";
import { REPORT_SCHEMA_VERSION } from "../src/index.js";
import { isSafeField, parseReportDefinition, validateReportDefinition } from "../src/report-schema.js";

const valid = {
  name: "order-list",
  title: "Orders",
  schema_version: REPORT_SCHEMA_VERSION,
  locale: "en",
  page: { width_mm: 210, height_mm: 297, margins_mm: { top: 10, right: 10, bottom: 10, left: 10 } },
  data: { collections: { orders: { database: "erp_sales", collection: "SalesOrder", sort: [{ field: "order_no", dir: 1 }] } } },
  bands: [
    {
      id: "rows",
      type: "data",
      binding: { collection: "orders" },
      height_mm: 6,
      objects: [
        { id: "no", type: "text", x_mm: 0, y_mm: 0, w_mm: 40, h_mm: 5, content: "{row.order_no}" },
        { id: "code", type: "barcode", x_mm: 50, y_mm: 0, w_mm: 30, h_mm: 5, symbology: "code128", value: "row.order_no" },
      ],
    },
  ],
};

describe("validateReportDefinition", () => {
  it("answers no refusal for a valid definition, which parses", () => {
    expect(validateReportDefinition(valid)).toEqual([]);
    expect(parseReportDefinition(valid).name).toBe("order-list");
  });

  it("PLANTED DEFECT: names every refused value by its path", () => {
    const broken = structuredClone(valid) as typeof valid;
    (broken.data.collections.orders as Record<string, unknown>).joins = [
      { as: "customer", collection: "Customer", local_field: "$where", foreign_field: "_id" },
    ];
    (broken.bands[0]!.objects[1] as { symbology: string }).symbology = "no-such-code";
    const paths = validateReportDefinition(broken).map((error) => error.path);
    expect(paths).toContain("data.collections.orders.joins.0.local_field");
    expect(paths).toContain("bands.0.objects.1.symbology");
  });

  it("takes the QR code of a Swiss QR bill, which bwip-js draws with its cross", () => {
    const bill = structuredClone(valid) as typeof valid;
    (bill.bands[0]!.objects[1] as { symbology: string }).symbology = "swissqrcode";
    expect(validateReportDefinition(bill)).toEqual([]);
  });
});

describe("isSafeField", () => {
  it("takes a dotted field name and refuses an operator or a path trick", () => {
    expect(isSafeField("customer.name")).toBe(true);
    expect(isSafeField("$where")).toBe(false);
    expect(isSafeField("a..b")).toBe(false);
  });
});
