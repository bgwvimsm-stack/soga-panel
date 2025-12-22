import rawTemplate from "./singboxTemplate.json";

type SingboxOutbound = Record<string, unknown>;
type SingboxConfig = Record<string, unknown>;
type GroupOverride = string[] | null | undefined;
type BuildOptions = {
  regionTags?: string[];
  availableRegionTags?: string[];
};

const CORE_OUTBOUND_TYPES = new Set(["direct", "block", "dns"]);

function cloneTemplate(): SingboxConfig {
  return JSON.parse(JSON.stringify(rawTemplate)) as SingboxConfig;
}

function uniqueTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = String(tag || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function filterRegionTags(values: string[], regionTagSet: Set<string>, availableRegionSet: Set<string>): string[] {
  return values.filter((item) => !regionTagSet.has(item) || availableRegionSet.has(item));
}

export function buildSingboxTemplate(
  nodeOutbounds: SingboxOutbound[] = [],
  groupOverrides: Record<string, GroupOverride> = {},
  options: BuildOptions = {}
) {
  const template = cloneTemplate() as any;
  const baseOutbounds: SingboxOutbound[] = [];
  const selectorOutbounds: SingboxOutbound[] = [];

  const regionTagSet = new Set(options.regionTags ?? []);
  const availableRegionSet = new Set(options.availableRegionTags ?? []);

  const outbounds = Array.isArray(template.outbounds) ? template.outbounds : [];
  for (const outbound of outbounds) {
    if (!outbound || typeof outbound !== "object") continue;
    const type = String((outbound as any).type || "");
    if (type === "selector") {
      selectorOutbounds.push(outbound as SingboxOutbound);
    } else if (CORE_OUTBOUND_TYPES.has(type)) {
      baseOutbounds.push(outbound as SingboxOutbound);
    }
  }

  const filteredSelectors: SingboxOutbound[] = [];

  for (const outbound of selectorOutbounds) {
    const tag = String((outbound as any).tag || "");
    if (regionTagSet.has(tag) && !availableRegionSet.has(tag)) {
      continue;
    }

    const override = groupOverrides[tag];
    if (override === null) {
      continue;
    }

    let outboundsList: string[] | undefined;
    if (Array.isArray(override)) {
      outboundsList = uniqueTags(override);
    } else if (Array.isArray((outbound as any).outbounds)) {
      outboundsList = (outbound as any).outbounds.map((item: unknown) => String(item));
    }

    if (outboundsList && regionTagSet.size) {
      outboundsList = filterRegionTags(outboundsList, regionTagSet, availableRegionSet);
    }

    if (outboundsList) {
      (outbound as any).outbounds = uniqueTags(outboundsList);
    }

    filteredSelectors.push(outbound as SingboxOutbound);
  }

  template.outbounds = [...baseOutbounds, ...nodeOutbounds, ...filteredSelectors];
  return template;
}
