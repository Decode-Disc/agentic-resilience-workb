import { operationResultValidator } from "@convex/execution/operationResults";
import { savedMaterialBinding } from "./savedMaterialOperations";
import {
    publicSearchResultValidator,
    referencedPublicSearchResultValidator,
} from "./workbenchContracts";

const legacyPublicSearchResult = operationResultValidator(
    publicSearchResultValidator,
);
const referencedPublicSearchResult = operationResultValidator(
    referencedPublicSearchResultValidator,
);

export function publicSearchWireResult(version: number) {
    return savedMaterialBinding("workbench_v1", version) === "referenced"
        ? referencedPublicSearchResult
        : legacyPublicSearchResult;
}
