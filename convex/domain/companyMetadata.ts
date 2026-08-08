type CompanyMetadata = {
    cik: string;
    legalName: string;
    ticker: string;
    exchange: string;
    investorRelationsUrl?: string;
    websiteUrl?: string;
    websiteUrlSource?: "sec_ir" | "exa" | "probe";
};

function normalizedCik(cik: string): string {
    return cik.replace(/^0+/, "") || "0";
}

export function mergeRunCompanyMetadata(
    snapshot: CompanyMetadata | undefined,
    current: CompanyMetadata | null,
): CompanyMetadata | undefined {
    const selected = snapshot ?? current ?? undefined;
    if (!selected) {
        return undefined;
    }
    if (
        snapshot &&
        current &&
        normalizedCik(snapshot.cik) !== normalizedCik(current.cik)
    ) {
        throw new Error("Research run company identity is inconsistent");
    }
    const currentWebsiteSource = current?.websiteUrlSource;
    const websiteUrlSource = current?.websiteUrl
        ? (currentWebsiteSource ??
          (current.websiteUrl === snapshot?.websiteUrl
              ? snapshot.websiteUrlSource
              : undefined))
        : selected.websiteUrlSource;
    return {
        cik: selected.cik,
        legalName: selected.legalName,
        ticker: selected.ticker,
        exchange: selected.exchange,
        investorRelationsUrl:
            current?.investorRelationsUrl ?? selected.investorRelationsUrl,
        websiteUrl: current?.websiteUrl ?? selected.websiteUrl,
        websiteUrlSource,
    };
}
