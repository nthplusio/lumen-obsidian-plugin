import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version
	?? JSON.parse(readFileSync("package.json", "utf8")).version;

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// for beta versions, write manifest-beta.json (used by BRAT)
if (targetVersion.includes("-beta")) {
	writeFileSync("manifest-beta.json", JSON.stringify(manifest, null, "\t") + "\n");
}

// update versions.json with target version and minAppVersion from manifest.json
// only for stable releases (beta versions are not added to the marketplace channel)
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!targetVersion.includes("-beta") && !(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
}
