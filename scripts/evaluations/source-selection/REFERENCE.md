# Source qualification reference judgments

Authored by the investigating assistant before any provider inference. This is an inspectable investigator reference, not independent human ground truth. The JSON reference owns expected answers and rationale. Positive classification never establishes current applicability, factual truth, publisher independence or corpus approval.

Dataset SHA-256: `5840934344478b693633de8149c6fc35eaba6ca0233875917d5013f8d5c905df`. Reference SHA-256: `e95f1a5302dfe447d33d2f4fb4dc5b98276803ba9d026d0cafdbbd69733d29cc`.

## doc_form3

This is an initial beneficial-ownership disclosure. Its tables describe a reporting person and securities holdings. It supplies neither subscription rights nor an executable API contract. Excluding it from the missing commercial and counter-analysis roles is justified.

Source: https://www.sec.gov/Archives/edgar/data/1373715/000177329826000002/xslF345X06/wk-form3_1780007887.xml

- document_kind: `ownership_filing`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "form3",
      "anchor": "INITIAL STATEMENT OF BENEFICIAL OWNERSHIP OF SECURITIES",
      "start_codepoints": 142,
      "end_codepoints": 197,
      "text_sha256": "f51a9c338eab835e6e346e0619cf8ded23bfc7c93a8d9d6a7ac6f9e0cecd28ed"
    }
  ]
}
```

## doc_analyst_day

The retrieved body announces the 2025 Financial Analyst Day. The discovery URL/title refers to 2023, so title-only classification is stale. An announcement promising presentations does not contain the presentation or establish that financial targets were achieved.

Source: https://www.servicenow.com/company/media/press-room/financial-analyst-day-2023.html

- document_kind: `event_announcement`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "analyst_day",
      "anchor": "will host its Financial Analyst Day 2025",
      "start_codepoints": 366,
      "end_codepoints": 406,
      "text_sha256": "06ef457d5189f53098744c4f1cbc428a92c87285ff2e658e8b5f56f4494b3eb2"
    }
  ]
}
```

## doc_platform_sheet

The document describes a common data model, workflow automation and integration capabilities. This is substantive product marketing, not API reference material: it supplies no callable operation and access contract. The shared data-model paragraph supports a product-description claim, not proof of customer outcomes.

Source: https://www.servicenow.com/standard/resource-center/data-sheet/ds-servicenow-platform.html

- document_kind: `product_description`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "platform_sheet",
      "anchor": "single data model",
      "start_codepoints": 1297,
      "end_codepoints": 1314,
      "text_sha256": "9779949f8aaa7da1f5f005663122a8a51f8ec1f38b55575328b6a172dbfcea4a"
    }
  ]
}
```

## doc_sales_sheet

The sheet markets lead-to-cash, order and fulfilment capabilities. Contract-related vocabulary describes what customers can manage using the product. It does not supply the terms governing ServiceNow subscriptions or an operational API specification.

Source: https://www.servicenow.com/standard/resource-center/data-sheet/ds-sales-and-order-management.html

- document_kind: `product_description`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "sales_sheet",
      "anchor": "Optimize the lead-to-cash cycle",
      "start_codepoints": 8456,
      "end_codepoints": 8487,
      "text_sha256": "c9eca7d62c68895438d1de892a3cd2e0021364729389009bd5bb0e0e9fc72ff5"
    }
  ]
}
```

## doc_store_rfq

The Store entry describes an application for submitting RFQs and viewing quotes. Installation terms, licensing headings and custom-table boilerplate do not turn it into a substantive subscription agreement. No mechanism harming ServiceNow revenue, pricing or margins is identified in the captured content.

Source: https://store.servicenow.com/store/app/eebdfef04739361439e06507e26d4334

- document_kind: `product_description`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "store_rfq",
      "anchor": "Submit an RFQ before placing an order",
      "start_codepoints": 982,
      "end_codepoints": 1019,
      "text_sha256": "c1ed01d7700128c349df394720c6ad4261ef50dc282bb6302df62fe9c4b5657e"
    }
  ]
}
```

## doc_store_contracts

The application manages customer service contracts and entitlements. Its data model and import capabilities describe product functionality. A mention of APIs is insufficient for the operational-API label, and Store installation boilerplate is insufficient for the subscription-agreement label. No adverse business mechanism or universal annual fee is established.

Source: https://store.servicenow.com/store/app/ddeae3e61b246a50a85b16db234bcb23

- document_kind: `product_description`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "store_contracts",
      "anchor": "foundation to manage customer service contracts and entitlements",
      "start_codepoints": 1027,
      "end_codepoints": 1091,
      "text_sha256": "327c92a610c872cc39c81b8e8c1eaf57fa83f3d301f9b4dc04cef3b1f2d7cf17"
    }
  ]
}
```

## doc_store_workflows

The application processes sales orders and contractual changes on behalf of customers. These customer contracts are not ServiceNow vendor terms. The text gives features and licensing requirements rather than callable endpoints or adverse competitive analysis.

Source: https://store.servicenow.com/store/app/44ea63e61b246a50a85b16db234bcbfb

- document_kind: `product_description`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "store_workflows",
      "anchor": "Capture and process sales orders and change orders",
      "start_codepoints": 1000,
      "end_codepoints": 1050,
      "text_sha256": "0bf2f4a6360d0e75355cc4a1abde24f6d4f091679b52314ac3a5ae0e8ddc444d"
    }
  ]
}
```

## doc_margin

This external generated primer includes an explicit adverse mechanism: AI features could become table stakes, weakening premium packaging and per-seat economics. That makes it a research lead even if its overall stance is favourable. Its numerical assertions and publisher reliability remain unverified.

Source: https://app.marginofinsight.com/stocks/NOW

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "margin",
      "anchor": "AI commoditization compressing premium SKUs",
      "start_codepoints": 9014,
      "end_codepoints": 9057,
      "text_sha256": "525ea64668efc16ffacbb803276ca697f5d8466f01c4aa11a707c8645fda158c"
    }
  ]
}
```

## doc_earningsmoat

This is an external earnings interpretation with substantive AI-competition and stock-compensation risks. It explicitly proposes that superior competing workflow tools could erode stickiness. Its zero-debt assertion is an assertion by the author, not independent corroboration. The earlier audit found that assertion inconsistent with the annual report; the current entailment test deliberately does not ask the model to know external accounts.

Source: https://earningsmoat.com/stocks/now-2025-earnings-analysis

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "earningsmoat",
      "anchor": "if competitors build superior AI workflow tools",
      "start_codepoints": 9910,
      "end_codepoints": 9957,
      "text_sha256": "a3356255e2a676161f8c9e89c92c76eff91087dce490559079381e89d4e99b5b"
    }
  ]
}
```

## doc_hated

The positive investment thesis includes a specific threat: large vendors can add workflow and AI functions that reduce demand for an independent orchestration layer. This is useful opposing material within a broadly favourable article. Classifying it as external analysis does not establish editorial independence, factual correctness or approved-corpus status.

Source: https://hatedmoats.substack.com/p/servicenow-deep-dive-analysis

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "hated",
      "anchor": "The risk here is that large vendors",
      "start_codepoints": 7130,
      "end_codepoints": 7165,
      "text_sha256": "7287280b52b4235e604bd3f4711b7c8f823a00229aa78a098e47cb39200f6f48"
    }
  ]
}
```

## doc_fsm

The analysis identifies conditional risks involving AI inference costs and the ability to monetise usage. It therefore contains an adverse mechanism despite its positive valuation conclusion. The passage does not establish that subscription gross margin has already fallen below 80%. Publisher qualification and disclosed conflicts require separate treatment.

Source: https://secure.fundsupermart.com/fsmone/article/rcms380621/servicenow-fy2027-the-time-is-now

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "fsm",
      "anchor": "Higher AI inference costs could pressure",
      "start_codepoints": 51588,
      "end_codepoints": 51628,
      "text_sha256": "b3d7bb44ae3401c1f8715ead4b07b48a6c36cb63af220b5270e38344d3c24ea1"
    }
  ]
}
```

## doc_flash

The report explicitly discusses custom workflows bypassing third-party orchestration and integration costs pressuring margins. These qualify as adverse mechanisms. Its acquisition timing was discrepant in the earlier audit. The semantic label does not rehabilitate that factual defect or validate forecasts.

Source: https://flash.stocksentinel.ai/research/NOW

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "flash",
      "anchor": "bypassing third-party orchestration layers",
      "start_codepoints": 23898,
      "end_codepoints": 23940,
      "text_sha256": "0409548a1c4009e4eef9fbde48bf1f39065c3848f149ddc05474148d9e2c41e4"
    }
  ]
}
```

## doc_capital

The author argues that bundled workflow automation can compete through software agreements customers already pay for. This is a concrete opposing mechanism, not evidence that Microsoft has already displaced most customers. The earlier audit identified a discrepant cRPO number; the mechanism and factual reliability must remain separate.

Source: https://capitalblueprint.substack.com/p/servicenow-inc-nyse-now-deep-analysis

- document_kind: `external_analysis`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "capital",
      "anchor": "good enough bundled",
      "start_codepoints": 14950,
      "end_codepoints": 14969,
      "text_sha256": "ec35efc627107348c44102c6f527fc4375009d9522221b1ff9665a0b7365e695"
    }
  ]
}
```

## doc_intellectia

This is secondary news reporting of a UBS downgrade, not the underlying UBS research note. It reports a possible revenue-growth mechanism through reductions in non-AI software budgets. Attribution should be preserved; the full UBS note and its independent authenticity have not been established.

Source: https://intellectia.ai/news/etf/ubs-downgrades-servicenow-to-neutral-amid-ai-disruption-risks

- document_kind: `news_report`
- subscription_agreement: `no`
- operational_api: `no`
- adverse_mechanism: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "intellectia",
      "anchor": "cut back on non-AI software budgets",
      "start_codepoints": 1002,
      "end_codepoints": 1037,
      "text_sha256": "f55b5a589890b63c3d07db694fd4674f767dd1613831b30835fac9a85df140bc"
    }
  ]
}
```

## doc_old_presentation

The URL originally described as a 4Q23 presentation now returns an events and presentations index. The body lists dated links and Get Details navigation, without the expected slides. Treating it as an investor presentation would mistake the discovery title for inspected content.

Source: https://www.servicenow.com/content/dam/servicenow/other-documents/investor-relations/investor-presentations/servicenow-q4-2023-investor-presentation.pdf

- document_kind: `index_navigation`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "old_presentation",
      "anchor": "Archived presentations",
      "start_codepoints": 9363,
      "end_codepoints": 9385,
      "text_sha256": "2173be34bb57079c14eab220a43ddc2d6176661500de7ab40b420ee886606878"
    }
  ]
}
```

## doc_sec_q1

The SEC exhibit contains reported quarterly earnings and cRPO figures. Its economic content is an earnings release even though it is filed under an 8-K accession. Accession identity alone cannot make the exhibit identical to the parent filing. The supplied passage supports the reported 12.64 billion number and contradicts 10.47 billion.

Source: https://www.sec.gov/Archives/edgar/data/1373715/000137371526000054/erq1fy26.htm

- document_kind: `earnings_release`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "sec_q1",
      "anchor": "Current remaining performance obligations of $12.64",
      "start_codepoints": 590,
      "end_codepoints": 641,
      "text_sha256": "ab376cdd848254b3b637aed7dda01a1393c5917eee99063b76b4d7528d22d89d"
    }
  ]
}
```

## doc_historical_contract

This contains substantive subscription rights, restrictions and obligations, including a non-transferable software licence. It is therefore an agreement. Its reseller host and historical provenance do not establish current canonical applicability. The prior audit observed a 2012 printed version; the supplied Markdown does not preserve that date, so no exact date label is scored.

Source: https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF

- document_kind: `commercial_agreement`
- subscription_agreement: `yes`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "historical_contract",
      "anchor": "Any Software is licensed and not sold",
      "start_codepoints": 4895,
      "end_codepoints": 4932,
      "text_sha256": "9fd183ded5d301e0dcd2112b392a4121ed8488c8d23ef7027715169e4a5a2c95"
    }
  ]
}
```

## doc_hr_api

The text specifies HR API access prerequisites and employee-profile operations with fields and example return data. This is operational technical documentation, not merely integration marketing. Its stated role and plugin requirements support an access restriction, but the excerpt does not establish OAuth-only authentication.

Source: https://www.servicenow.com/docs/r/api-reference/rest-apis/hr-core-api.html

- document_kind: `technical_documentation`
- subscription_agreement: `no`
- operational_api: `yes`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "hr_api",
      "anchor": "To access this API you must have",
      "start_codepoints": 25153,
      "end_codepoints": 25185,
      "text_sha256": "ebde9d7e89efd65b02f56af83f1d39a2f9463b439421d9b4f2ad35569bff1586"
    }
  ]
}
```

## doc_q1_presentation

The capture contains investor slides, financial tables and Q1 2026 performance discussion. It is the presentation itself, not an announcement or link index. It is a meaningful alternative to the stale presentation URL. First-party financial reporting is not independent verification of all management statements.

Source: https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf

- document_kind: `investor_presentation`
- subscription_agreement: `no`
- operational_api: `no`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "q1_presentation",
      "anchor": "Year-Over-Year Subscription Revenues Growth",
      "start_codepoints": 23509,
      "end_codepoints": 23552,
      "text_sha256": "f6ed74f2eecc137ade3051d21e6bb1486e46e9160eaaea6d0f398d388182d66c"
    }
  ]
}
```

## relation_crpo

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "sec_q1",
      "exact_passage": "•Current remaining performance obligations of $12.64 billion as of Q1 2026, representing 22.5% year-over-year growth, 21% in constant currency"
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "ServiceNow reported current remaining performance obligations of $12.64 billion for Q1 2026.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "ServiceNow reported current remaining performance obligations of $10.47 billion for Q1 2026.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "ServiceNow's Q1 2026 cRPO was independently audited by this document's author.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_api_access

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "hr_api",
      "exact_passage": "To access this API you must have the sn\\_hr\\_core.usa\\_employee\\_only role and the Human\nResources Scoped App: Core (com\\_sn\\_hr\\_core) plugin activated."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "Access to the HR REST API requires the specified HR role and activated HR Core plugin.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "Anyone can access the HR REST API without a required role or plugin.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "OAuth is the only authentication method accepted by the HR REST API.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_margin_risk

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "fsm",
      "exact_passage": "Higher AI inference costs could pressure\nsubscription gross margins if customer adoption accelerates faster than\nServiceNow's ability to monetise AI usage through hybrid pricing. While\nmanagement currently expects subscription gross margins above 80%, sustained\nincreases in compute intensity remain a key execution risk."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "The analyst identifies a conditional risk to subscription gross margins if AI adoption grows faster than monetisation.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "The analyst says higher AI inference costs cannot pressure subscription gross margins.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "AI inference costs have already reduced ServiceNow's subscription gross margin below 80%.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_license

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "historical_contract",
      "exact_passage": "3.2. <u>SOFTW ARE</u>. ServiceNow may provide ServiceNow software products **(“Software”)** for use in connection \nwith the Subscription Service. Any Software is licensed and not sold, and ServiceNow grants Customer a limited, personal, \nworldwide, non-sublicensable, non-transferable, non-exclusive license to install and execute the Software on machines"
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "The software is licensed rather than sold, and the stated license is non-transferable.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "The agreement sells ownership of the software and grants a freely transferable license.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "This document is the canonical ServiceNow agreement currently applicable in October 2026.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_contracts_product

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `not_established`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "store_contracts",
      "exact_passage": "This application acts as a foundation to manage customer service contracts and entitlements."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "The application provides a foundation for managing customer service contracts and entitlements.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "ServiceNow's subscription contract grants every customer unrestricted resale rights.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    },
    "claim_2": {
      "claim": "This application includes ServiceNow's complete subscription agreement.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_bundling

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "capital",
      "exact_passage": "The generic AI agent substitute threat (Microsoft Copilot, Google Gemini) is real, but generic framing understates the specific mechanism. Microsoft’s threat is not that Copilot is technically superior to ServiceNow’s ITSM workflow engine — it almost certainly is not for complex multi-workflow scenarios. The threat is that Microsoft can offer **“good enough bundled”** IT workflow automation as part of Microsoft 365 / Azure agreements that enterprises already pay for. This is the most historically dangerous competitive motion against best-of-breed SaaS."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "The author argues Microsoft could compete through bundled workflow automation in agreements enterprises already pay for.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "The author rules out Microsoft bundling as a threat to best-of-breed SaaS.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "Microsoft has already displaced ServiceNow at a majority of its enterprise customers.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_reported_debt

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "earningsmoat",
      "exact_passage": "Capital allocation scores 85/100 — zero long-term debt, mode..."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "The author asserts that ServiceNow has zero long-term debt.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "The author asserts that ServiceNow has substantial long-term debt.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "The author's assertion has been corroborated against ServiceNow's audited accounts.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## relation_event

Relation to supplied text, not truth in the world. Assertions, conditional risks, verified facts and current applicability must remain distinct.

- claim_0: `supports`
- claim_1: `contradicts`
- claim_2: `not_established`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "analyst_day",
      "exact_passage": "**SANTA CLARA, Calif. – April 14, 2025** – [ServiceNow](https://www.servicenow.com/) (NYSE: NOW) will host its Financial Analyst Day 2025 on Monday, May 5, at 1:30pm PT in Las Vegas. This half‑day program will feature presentations by ServiceNow executives who will provide financial updates and showcase how ServiceNow is putting AI to work across every aspect of business to unlock full enterprise automation."
    }
  ],
  "claims": {
    "claim_0": {
      "claim": "ServiceNow announced that its Financial Analyst Day 2025 would be held on May 5.",
      "expected": "supports",
      "reason": "Directly stated or entailed by the supplied passage, retaining its attribution and modality."
    },
    "claim_1": {
      "claim": "This announcement says the Financial Analyst Day was cancelled.",
      "expected": "contradicts",
      "reason": "Conflicts with an explicit statement in the supplied passage."
    },
    "claim_2": {
      "claim": "The announcement establishes that all of management's long-term financial targets were achieved.",
      "expected": "not_established",
      "reason": "The necessary fact, corroboration, universality, current applicability or observed outcome is absent from this passage."
    }
  }
}
```

## passage_hated_bundling

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p001`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "hated",
      "target_passage": "As far as competition goes, the peer set is broad, but not all competitors threaten ServiceNow equally. Microsoft, Oracle, SAP, Salesforce, and Workday all compete in parts of the market, yet their products are often systems of record rather than cross-enterprise workflow layers. ServiceNow has historically complemented those suites by orchestrating work across them instead of replacing them. The risk here is that large vendors keep adding workflow and AI features to their own platforms, reducing the need for an independent orchestration layer. That matters even more in an AI world, where every vendor wants to be the “agentic” layer for enterprise automation, especially since it’s such a buzzword these days."
    }
  ]
}
```

## passage_fsm_compute

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p005`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "fsm",
      "target_passage": "Higher AI inference costs could pressure\nsubscription gross margins if customer adoption accelerates faster than\nServiceNow's ability to monetise AI usage through hybrid pricing. While\nmanagement currently expects subscription gross margins above 80%, sustained\nincreases in compute intensity remain a key execution risk."
    }
  ]
}
```

## passage_capital_bundling

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p005`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "capital",
      "target_passage": "The generic AI agent substitute threat (Microsoft Copilot, Google Gemini) is real, but generic framing understates the specific mechanism. Microsoft’s threat is not that Copilot is technically superior to ServiceNow’s ITSM workflow engine — it almost certainly is not for complex multi-workflow scenarios. The threat is that Microsoft can offer **“good enough bundled”** IT workflow automation as part of Microsoft 365 / Azure agreements that enterprises already pay for. This is the most historically dangerous competitive motion against best-of-breed SaaS."
    }
  ]
}
```

## passage_api_roles

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p006`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "hr_api",
      "target_passage": "To access this API you must have the sn\\_hr\\_core.usa\\_employee\\_only role and the Human\nResources Scoped App: Core (com\\_sn\\_hr\\_core) plugin activated."
    }
  ]
}
```

## passage_software_rights

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p003`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "historical_contract",
      "target_passage": "3.2. <u>SOFTW ARE</u>. ServiceNow may provide ServiceNow software products **(“Software”)** for use in connection \nwith the Subscription Service. Any Software is licensed and not sold, and ServiceNow grants Customer a limited, personal, \nworldwide, non-sublicensable, non-transferable, non-exclusive license to install and execute the Software on machines"
    }
  ]
}
```

## passage_store_absent

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `none`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "store_contracts",
      "target_passage": null
    }
  ]
}
```

## passage_event_absent

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `none`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "analyst_day",
      "target_passage": null
    }
  ]
}
```

## passage_product_capability

Human-selected positive passage among fixed source distractors, or an intentionally unanswerable question. This is a localization probe, not a full retrieval evaluation.

- passage: `p001`

Recorded evidence and claim-specific judgments:

```json
{
  "evidence": [
    {
      "source": "platform_sheet",
      "target_passage": "Born in the cloud and built from the ground up with a single data model and a single, extensible and scalable architecture, the Now Platform enables data to flow seamlessly across applications and existing systems. The Now Platform delivers workflow automation at an enterprise scale, allowing you to optimize business processes for productivity, agility, and resiliency."
    }
  ]
}
```
