// Pure physical lighting, colour temperature, and EV100 exposure math (no three.js).
// Equations from NUMBERS.md and Lagarde & de Rousiers 2014 (Moving Frostbite to PBR).

export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * EV100 for a given incident illuminance (lux) using standard reflected-light metering
 * constant K = 12.5, S = 100 (incident constant C = 250): EV100 = log2(lux * 100 / 250).
 * Clear noon (100 000 lx) -> EV100 = 15.288.
 */
export function ev100FromLux(illuminanceLux: number): number {
  const safeLux = Math.max(1e-4, illuminanceLux);
  return Math.log2((safeLux * 100) / 250);
}

/**
 * Exposure multiplier converting scene luminance (cd/m^2) to normalised sensor units:
 * exposure = 1 / (1.2 * 2^EV100). (NUMBERS.md, GUIDE.md §4.)
 */
export function exposureFromEv100(ev100: number): number {
  return 1 / (1.2 * Math.pow(2, ev100));
}

/**
 * Compute preset anchor EV100 from total horizontal illuminance (direct sun * sin(elev) + sky).
 * Keeps noon, late afternoon, golden hour, and overcast physically exposed without clipping.
 */
export function presetAnchorEv100(sunIlluminanceLux: number, skyIlluminanceLux: number, sunElevationDeg: number): number {
  const sinElev = Math.max(0.05, Math.sin((sunElevationDeg * Math.PI) / 180));
  const horizontalLux = sunIlluminanceLux * sinElev + skyIlluminanceLux;
  return ev100FromLux(horizontalLux);
}

/** Standard IEC 61966-2-1 sRGB transfer channel -> linear. */
export function srgbToLinear(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Standard linear -> IEC 61966-2-1 sRGB transfer channel. */
export function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * Correlated colour temperature (kelvin, 1500..25000 K) -> luminance-normalised linear RGB.
 * Normalised so Rec.709 luminance Y = 1.0; scaling by lux preserves physical illuminance.
 */
export function kelvinToLinearRgb(kelvin: number): LinearRgb {
  const temp = Math.max(1000, Math.min(40_000, kelvin)) / 100;
  let sr: number;
  let sg: number;
  let sb: number;
  if (temp <= 66) {
    sr = 255;
    sg = 99.4708025861 * Math.log(temp) - 161.1195681661;
    sb = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    sr = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    sg = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    sb = 255;
  }
  const lr = srgbToLinear(sr / 255);
  const lg = srgbToLinear(sg / 255);
  const lb = srgbToLinear(sb / 255);
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const inv = y > 1e-6 ? 1 / y : 1;
  return { r: lr * inv, g: lg * inv, b: lb * inv };
}

/**
 * Expected exposed linear radiance of a Lambertian diffuse surface under direct illuminance
 * (plus optional diffuse sky illuminance).
 * L_out = (albedo / pi) * (E_sun * cosTheta + E_sky) * exposure(EV100).
 */
export function expectedExposedLambertian(
  albedoLinear: number,
  sunIlluminanceLux: number,
  cosTheta: number,
  skyIlluminanceLux: number,
  ev100: number,
): number {
  const direct = sunIlluminanceLux * Math.max(0, cosTheta);
  const radianceCdM2 = (albedoLinear / Math.PI) * (direct + skyIlluminanceLux);
  return radianceCdM2 * exposureFromEv100(ev100);
}

/** Sun direction unit vector (pointing toward the sun) from elevation & azimuth in degrees. */
export function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number): { x: number; y: number; z: number } {
  const elev = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const cosE = Math.cos(elev);
  return {
    x: Math.sin(az) * cosE,
    y: Math.sin(elev),
    z: Math.cos(az) * cosE,
  };
}

/**
 * Practical-logarithmic CSM cascade split fractions in (0, 1] (Zhang et al. 2006).
 * Matches `CSMShadowNode` customSplitsCallback signature (always ends with 1.0).
 */
export function computeCsmSplits(
  cascades: number,
  cameraNearM: number,
  shadowFarM: number,
  lambda = 0.65,
): number[] {
  const count = Math.max(1, Math.floor(cascades));
  const near = Math.max(0.05, cameraNearM);
  const far = Math.max(near + 1, shadowFarM);
  const l = Math.max(0, Math.min(1, lambda));
  const out: number[] = [];
  for (let i = 1; i < count; i++) {
    const p = i / count;
    const logSplit = (near * Math.pow(far / near, p)) / far;
    const uniSplit = (near + (far - near) * p) / far;
    out.push(uniSplit + (logSplit - uniSplit) * l);
  }
  out.push(1.0);
  return out;
}

/**
 * Height-integrated exponential aerial perspective optical depth along a ray (playbook §4 #4):
 *   tau = rho0 * d * exp(-f * h0) * (1 - exp(-f * (h1 - h0))) / (f * (h1 - h0))
 * Keeps valley mist realistic at ground/RTS views while automatically thinning at high-altitude overview.
 */
export function heightFogOpticalDepth(
  distanceM: number,
  camHeightM: number,
  targetHeightM: number,
  densityPerM: number,
  heightFalloffPerM: number,
): number {
  const d = Math.max(0, distanceM);
  const rho0 = Math.max(0, densityPerM);
  if (d <= 0 || rho0 <= 0) return 0;
  const f = Math.max(0, heightFalloffPerM);
  const h0 = Math.max(0, camHeightM);
  const h1 = Math.max(0, targetHeightM);
  if (f <= 1e-6) return rho0 * d;
  const u = f * (h1 - h0);
  const base = Math.exp(-f * h0);
  const ratio = Math.abs(u) < 1e-3 ? 1 - 0.5 * u + (u * u) / 6 : (1 - Math.exp(-u)) / u;
  return Math.max(0, rho0 * d * base * ratio);
}

/** Transmittance complement 1 - exp(-tau), clamped to maxOpacity (default 0.96). */
export function heightFogFactor(
  distanceM: number,
  camHeightM: number,
  targetHeightM: number,
  densityPerM: number,
  heightFalloffPerM: number,
  maxOpacity = 0.96,
): number {
  const tau = heightFogOpticalDepth(distanceM, camHeightM, targetHeightM, densityPerM, heightFalloffPerM);
  return Math.min(maxOpacity, Math.max(0, 1 - Math.exp(-tau)));
}
