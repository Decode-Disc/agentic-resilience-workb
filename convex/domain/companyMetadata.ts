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

/** A resolved website is a supplied HTTPS address; absence must remain undefined. */
export function requireCompanyWebsiteUrl(websiteUrl: string): void {
    try {
        const url = new URL(websiteUrl);
        if (
            websiteUrl === websiteUrl.trim() &&
            url.protocol === "https:" &&
            !url.username &&
            !url.password
        )
            return;
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
    }
    throw new Error(
        "websiteUrl must be an absolute HTTPS URL without credentials",
    );
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
    const websiteUrl = current?.websiteUrl ?? selected.websiteUrl;
    if (websiteUrl !== undefined) requireCompanyWebsiteUrl(websiteUrl);
    const currentWebsiteSource = current?.websiteUrlSource;
    const websiteUrlSource =
        current?.websiteUrl !== undefined
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
        websiteUrl,
        websiteUrlSource,
    };
}
