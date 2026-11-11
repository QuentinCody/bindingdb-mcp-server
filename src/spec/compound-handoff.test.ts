import { expect, it, vi } from "vitest";
import { compoundHandoffWorkflow } from "./compound-handoff";
const run = (get: unknown, code = compoundHandoffWorkflow.code) => new Function("api", `return (async () => {${code}})();`)({ get });

it.each([0.85, 1])("never upgrades similarity %s to compound identity", async cutoff => {
  const candidates = { observations: [{ monomerid: "00123", smiles: "different", affinity_type: "Ki", affinity: ">100", target: "P00533" }] };
  const get = vi.fn().mockResolvedValue(candidates);
  expect(await run(get, compoundHandoffWorkflow.code.replace("similarity_cutoff: 0.85", `similarity_cutoff: ${cutoff}`)))
    .toMatchObject({ candidates, identity_verified: false, coverage_complete: false });
  expect(get).toHaveBeenCalledExactlyOnceWith("/rest/getTargetByCompound", { smiles: "CC(=O)OC1=CC=CC=C1C(=O)O", cutoff });
});
it.each([{}, { __staged: true, data_access_id: "native-binding" }])("retains empty or staged native results %j", async candidates => {
  expect(await run(vi.fn().mockResolvedValue(candidates))).toMatchObject({ candidates, identity_verified: false });
});
it("surfaces both returned and thrown upstream errors", async () => {
  const error = { __api_error: true, status: 503, data: { native: "error" } };
  expect(await run(vi.fn().mockResolvedValue(error))).toMatchObject(error);
  expect(await run(vi.fn().mockRejectedValue(Object.assign(new Error("unavailable"), { status: 504 })))).toMatchObject({ __api_error: true, status: 504, message: "unavailable" });
});
