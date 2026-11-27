import * as THREE from 'three';
import type { VisitorDef } from '../data/schemas';
import { SpeechBubble } from './SpeechBubble';

export type VisitorPose =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'dance'
  | 'pet'
  | 'admire';

export type VisitorVariantIndex = 0 | 1 | 2;

export const FLOOR_BASE_Y = 0.024;

type HairStyleId =
  | 'bob'
  | 'fringe_messy'
  | 'high_bun'
  | 'quiff'
  | 'side_waves'
  | 'chic_crop'
  | 'curly_puff'
  | 'short_curls'
  | 'twin_buns'
  | 'long_waves'
  | 'spiky'
  | 'high_ponytail'
  | 'pastel_fade'
  | 'shoulder_waves'
  | 'short_wavy'
  | 'top_knot'
  | 'natural_curls'
  | 'tousled_fringe'
  | 'sleek_long_bob'
  | 'undercut'
  | 'tapered_fade';

type OutfitStyleId =
  | 'cardigan'
  | 'cardigan_scarf'
  | 'turtleneck'
  | 'trench_crossbody'
  | 'oversized_sweater'
  | 'bomber_jacket'
  | 'denim_overalls'
  | 'linen_shirt'
  | 'hoodie'
  | 'street_jacket'
  | 'chef_apron'
  | 'studio_smock'
  | 'corduroy_jacket';

interface VariantStyle {
  skin: string;
  hair: string;
  hairAccent?: string;
  top: string;
  inner: string;
  bottom: string;
  shoe: string;
  accent: string;
  skirt?: boolean;
  hairStyle: HairStyleId;
  outfitStyle: OutfitStyleId;
  glasses?: boolean;
  sunglassesOnHead?: boolean;
  catEars?: boolean;
  ribbonBows?: boolean;
  neckHeadphones?: boolean;
  wornHeadphones?: boolean;
  toteBag?: boolean;
  crossbodyBag?: boolean;
}

/**
 * 30 distinct modern low-poly personas (10 archetypes × 3 gender-varied variants).
 * Every variant aligns with the named personas in `data/visitors.json`.
 */
const ARCHETYPE_VARIANTS: Record<string, [VariantStyle, VariantStyle, VariantStyle]> = {
  // Maya (she/her), Julian (he/him), Rowan (they/them)
  bookworm: [
    {
      skin: '#F6E0CE',
      hair: '#4B362A',
      top: '#8FAEC9',
      inner: '#FAF3E8',
      bottom: '#C9B89E',
      shoe: '#6E5645',
      accent: '#E2C39B',
      hairStyle: 'bob',
      outfitStyle: 'cardigan',
      glasses: true,
    },
    {
      skin: '#E6BF9F',
      hair: '#624130',
      top: '#7B9AB5',
      inner: '#F6EDE1',
      bottom: '#566375',
      shoe: '#8A664C',
      accent: '#E9D6BE',
      hairStyle: 'fringe_messy',
      outfitStyle: 'cardigan_scarf',
      glasses: true,
    },
    {
      skin: '#C89370',
      hair: '#2E2522',
      top: '#A9BDD4',
      inner: '#FBF5EC',
      bottom: '#E6DCCD',
      shoe: '#5E4B42',
      accent: '#D5B097',
      skirt: true,
      hairStyle: 'high_bun',
      outfitStyle: 'turtleneck',
      glasses: true,
    },
  ],
  // Leo (he/him), Clara (she/her), Devon (they/them)
  coffee_snob: [
    {
      skin: '#F3DCC9',
      hair: '#3F2D23',
      top: '#C79E79',
      inner: '#F7EFE4',
      bottom: '#56473E',
      shoe: '#4A3A31',
      accent: '#7D553C',
      hairStyle: 'quiff',
      outfitStyle: 'trench_crossbody',
      crossbodyBag: true,
    },
    {
      skin: '#E6BE9E',
      hair: '#5E3D2C',
      top: '#D8C2A6',
      inner: '#8FA895',
      bottom: '#5E4D42',
      shoe: '#6A4C3A',
      accent: '#8B5D41',
      hairStyle: 'side_waves',
      outfitStyle: 'trench_crossbody',
      crossbodyBag: true,
    },
    {
      skin: '#C28D6A',
      hair: '#29221F',
      top: '#A98365',
      inner: '#F6ECE0',
      bottom: '#4D5259',
      shoe: '#F3ECE2',
      accent: '#7A5038',
      hairStyle: 'chic_crop',
      outfitStyle: 'trench_crossbody',
      crossbodyBag: true,
      sunglassesOnHead: true,
    },
  ],
  // Mina (she/her), Toby (he/him), Avery (they/them)
  cat_person: [
    {
      skin: '#F8E3D4',
      hair: '#5C3D34',
      top: '#F0B6C2',
      inner: '#FFF7F4',
      bottom: '#7C8FA6',
      shoe: '#FBF5F2',
      accent: '#E28FA2',
      skirt: true,
      hairStyle: 'curly_puff',
      outfitStyle: 'oversized_sweater',
      catEars: true,
    },
    {
      skin: '#EAC4A6',
      hair: '#6B4934',
      top: '#F2C6B8',
      inner: '#FFF8F3',
      bottom: '#657384',
      shoe: '#EFE5DF',
      accent: '#E397A4',
      hairStyle: 'short_curls',
      outfitStyle: 'oversized_sweater',
    },
    {
      skin: '#CA9675',
      hair: '#2E2324',
      top: '#E3B9D6',
      inner: '#FFF8FA',
      bottom: '#EFE7DC',
      shoe: '#D999B0',
      accent: '#CA8CB6',
      skirt: true,
      hairStyle: 'twin_buns',
      outfitStyle: 'oversized_sweater',
      ribbonBows: true,
    },
  ],
  // Zara (she/her), Nico (he/him), Kai (they/them)
  party_goer: [
    {
      skin: '#E2B996',
      hair: '#4C2E43',
      top: '#E0A8C8',
      inner: '#FAF3EA',
      bottom: '#EFECE6',
      shoe: '#C7A9E6',
      accent: '#9AE0C6',
      hairStyle: 'high_ponytail',
      outfitStyle: 'bomber_jacket',
      neckHeadphones: true,
    },
    {
      skin: '#F4DCC9',
      hair: '#3A2E46',
      top: '#C7A9E6',
      inner: '#FFF8EF',
      bottom: '#58627A',
      shoe: '#F6F2FB',
      accent: '#F2A3B8',
      hairStyle: 'spiky',
      outfitStyle: 'bomber_jacket',
      neckHeadphones: true,
    },
    {
      skin: '#BF8A69',
      hair: '#2B2834',
      hairAccent: '#B5E6D3',
      top: '#8F96C9',
      inner: '#FCE9D8',
      bottom: '#4B4F5C',
      shoe: '#F4F1FA',
      accent: '#E4A8F0',
      hairStyle: 'pastel_fade',
      outfitStyle: 'bomber_jacket',
      neckHeadphones: true,
    },
  ],
  // Elena (she/her), Mateo (he/him), Sage (they/them)
  plant_lover: [
    {
      skin: '#F6E2D2',
      hair: '#7A5236',
      top: '#95C2A2',
      inner: '#FAF4E8',
      bottom: '#7C98B3',
      shoe: '#D2A679',
      accent: '#E8DEC8',
      hairStyle: 'shoulder_waves',
      outfitStyle: 'denim_overalls',
      toteBag: true,
    },
    {
      skin: '#E3B997',
      hair: '#422F23',
      top: '#A4C9A8',
      inner: '#F7EFE2',
      bottom: '#758768',
      shoe: '#9C785B',
      accent: '#EFE5D1',
      hairStyle: 'short_wavy',
      outfitStyle: 'linen_shirt',
      toteBag: true,
    },
    {
      skin: '#C38F6D',
      hair: '#2E241E',
      top: '#F0DFB8',
      inner: '#FFF8EC',
      bottom: '#87AF94',
      shoe: '#C69A72',
      accent: '#EFE5D1',
      hairStyle: 'natural_curls',
      outfitStyle: 'denim_overalls',
      toteBag: true,
    },
  ],
  // Sora (they/them), Nadia (she/her), Ethan (he/him)
  night_owl: [
    {
      skin: '#F3DFD2',
      hair: '#303242',
      top: '#7F8AB8',
      inner: '#D8DCF0',
      bottom: '#494E61',
      shoe: '#ECEEF5',
      accent: '#C9C2EA',
      hairStyle: 'tousled_fringe',
      outfitStyle: 'hoodie',
      wornHeadphones: true,
    },
    {
      skin: '#E4BEA0',
      hair: '#252633',
      top: '#8D86B0',
      inner: '#6A6E82',
      bottom: '#434654',
      shoe: '#C8CBE0',
      accent: '#A9B6E0',
      hairStyle: 'sleek_long_bob',
      outfitStyle: 'street_jacket',
      neckHeadphones: true,
    },
    {
      skin: '#C69273',
      hair: '#222430',
      top: '#6E859E',
      inner: '#D5E2EB',
      bottom: '#4B505B',
      shoe: '#E8ECF2',
      accent: '#B5C8E8',
      hairStyle: 'undercut',
      outfitStyle: 'hoodie',
      wornHeadphones: true,
    },
  ],
  // Chloe (she/her), Omar (he/him), Jules (they/them)
  foodie: [
    {
      skin: '#F7E1CE',
      hair: '#7D4E32',
      top: '#E09F83',
      inner: '#FAF3E4',
      bottom: '#768291',
      shoe: '#9C7356',
      accent: '#F5E4BE',
      skirt: true,
      hairStyle: 'bob',
      outfitStyle: 'chef_apron',
    },
    {
      skin: '#D6A47E',
      hair: '#2A2320',
      top: '#95AA84',
      inner: '#FAF4E8',
      bottom: '#4D5258',
      shoe: '#634E3F',
      accent: '#EDE0C7',
      hairStyle: 'tapered_fade',
      outfitStyle: 'chef_apron',
    },
    {
      skin: '#E9C3A3',
      hair: '#5A3A2B',
      top: '#E9C478',
      inner: '#FFF8EB',
      bottom: '#677465',
      shoe: '#A17C5E',
      accent: '#E39A82',
      hairStyle: 'top_knot',
      outfitStyle: 'chef_apron',
    },
  ],
  // Priya (she/her), Theo (he/him), Quinn (they/them)
  artist: [
    {
      skin: '#C58D6B',
      hair: '#262023',
      top: '#E3A1B0',
      inner: '#FAF2EB',
      bottom: '#626878',
      shoe: '#E7D8C7',
      accent: '#F2CFA1',
      hairStyle: 'long_waves',
      outfitStyle: 'studio_smock',
      toteBag: true,
    },
    {
      skin: '#F2DAC7',
      hair: '#694731',
      top: '#8AB8B5',
      inner: '#FAF3E8',
      bottom: '#C9B396',
      shoe: '#7B604C',
      accent: '#E59FA8',
      hairStyle: 'short_curls',
      outfitStyle: 'linen_shirt',
      crossbodyBag: true,
    },
    {
      skin: '#E6BFA0',
      hair: '#4D3B46',
      hairAccent: '#F2C0B8',
      top: '#D4A8C4',
      inner: '#FAF3EC',
      bottom: '#5A5E6C',
      shoe: '#EFE5DF',
      accent: '#A9C8BA',
      hairStyle: 'side_waves',
      outfitStyle: 'cardigan_scarf',
      glasses: true,
    },
  ],
  // Marcus (he/him), Yuki (she/her), Alex (they/them)
  musician: [
    {
      skin: '#B98262',
      hair: '#241E1D',
      top: '#B5896A',
      inner: '#F7EFE2',
      bottom: '#535B6E',
      shoe: '#EFE9E0',
      accent: '#9CB2E0',
      hairStyle: 'natural_curls',
      outfitStyle: 'corduroy_jacket',
      neckHeadphones: true,
    },
    {
      skin: '#F6E2D5',
      hair: '#2B2B36',
      top: '#9CAEDB',
      inner: '#F8F4EE',
      bottom: '#656A7C',
      shoe: '#E6E2DC',
      accent: '#E8B2C2',
      skirt: true,
      hairStyle: 'sleek_long_bob',
      outfitStyle: 'oversized_sweater',
      wornHeadphones: true,
    },
    {
      skin: '#E5BD9E',
      hair: '#4E392E',
      top: '#8AA3C7',
      inner: '#F3DEC9',
      bottom: '#4F5461',
      shoe: '#D4B89B',
      accent: '#7A6454',
      hairStyle: 'fringe_messy',
      outfitStyle: 'corduroy_jacket',
      crossbodyBag: true,
    },
  ],
  // Hannah (she/her), Ben (he/him), Sam (they/them)
  homebody: [
    {
      skin: '#F6E0CE',
      hair: '#784E35',
      top: '#E5B49A',
      inner: '#FFF7EE',
      bottom: '#D7C8B5',
      shoe: '#B6957E',
      accent: '#F2D8C4',
      hairStyle: 'high_bun',
      outfitStyle: 'cardigan',
    },
    {
      skin: '#E4BC9D',
      hair: '#4C3629',
      top: '#D9C5A9',
      inner: '#FAF4EA',
      bottom: '#778491',
      shoe: '#8C7462',
      accent: '#C4D4BC',
      hairStyle: 'short_wavy',
      outfitStyle: 'oversized_sweater',
    },
    {
      skin: '#C99473',
      hair: '#2D2420',
      top: '#B5CEB8',
      inner: '#FAF6EE',
      bottom: '#948B82',
      shoe: '#EFE6DA',
      accent: '#E8B8A4',
      hairStyle: 'curly_puff',
      outfitStyle: 'hoodie',
    },
  ],
};

function shadeHex(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

/**
 * Clean, solid, zero-clipping low-poly figurine for Cozyhouse visitors.
 * - 100% opaque character materials (`transparent: false, depthWrite: true`) prevent
 *   inside-out depth sorting glitches.
 * - Strict non-coplanar geometry offsets keep face features, glasses, hair, jackets,
 *   sleeves, skirts, and limbs cleanly separated across all animations and 3/4 portraits.
 * - Supports smooth scale-in/scale-out pops (`setScalePop`) instead of alpha fading.
 */
export class VisitorMesh {
  readonly root = new THREE.Group();
  readonly bodyPivot = new THREE.Group();
  readonly torsoPivot = new THREE.Group();
  readonly headPivot = new THREE.Group();
  readonly leftLegPivot = new THREE.Group();
  readonly rightLegPivot = new THREE.Group();
  readonly leftArmPivot = new THREE.Group();
  readonly rightArmPivot = new THREE.Group();
  readonly mouthMesh: THREE.Mesh;
  readonly speechBubble = new SpeechBubble();
  readonly variantIndex: VisitorVariantIndex;

  private readonly wearsSkirt: boolean;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private animPhase = Math.random() * Math.PI * 2;
  private blabberPhase = 0;

  constructor(def: VisitorDef, variantIndex: VisitorVariantIndex = 0) {
    this.variantIndex = variantIndex;
    this.root.name = `Visitor_${def.id}_v${variantIndex}`;

    const style = this.resolveStyle(def, variantIndex);
    this.wearsSkirt = Boolean(style.skirt);

    this.root.add(this.bodyPivot);

    // Soft ground shadow disc (the ONLY transparent mesh, flush at FLOOR_BASE_Y + 0.004)
    const shadowGeo = this.trackGeo(new THREE.CircleGeometry(0.24, 16));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x453930,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
      }),
    );
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = FLOOR_BASE_Y + 0.004;
    this.root.add(shadow);

    // Ground body pivot flush on FLOOR_BASE_Y
    this.bodyPivot.position.y = FLOOR_BASE_Y;

    // 100% opaque pastel materials (zero alpha-sorting / inside-out glitches!)
    const skinMat = this.makeMat(style.skin, 0.84);
    const hairMat = this.makeMat(style.hair, 0.8);
    const hairAccentMat = this.makeMat(style.hairAccent ?? style.hair, 0.78);
    const topMat = this.makeMat(style.top, 0.82);
    const topDarkMat = this.makeMat(shadeHex(style.top, 0.82), 0.82);
    const innerMat = this.makeMat(style.inner, 0.84);
    const bottomMat = this.makeMat(style.bottom, 0.84);
    const shoeMat = this.makeMat(style.shoe, 0.78);
    const soleMat = this.makeMat('#FAF6F0', 0.85);
    const sockMat = this.makeMat('#F7F1E8', 0.86);
    const accentMat = this.makeMat(style.accent, 0.78);
    const eyeMat = this.makeMat('#352B26', 0.35);
    const eyeShineMat = this.makeMat('#FFFFFF', 0.2);
    const blushMat = this.makeMat('#F0A3A3', 0.86);
    const metalMat = this.makeMat('#D7C28D', 0.38, 0.45);

    // 1. Articulated Legs & Sneakers (hinged at hip y = 0.36; hip ball prevents gaps when sitting)
    this.leftLegPivot.position.set(-0.072, 0.36, 0);
    this.rightLegPivot.position.set(0.072, 0.36, 0);
    this.buildLeg(this.leftLegPivot, style.skirt ? skinMat : bottomMat, sockMat, shoeMat, soleMat);
    this.buildLeg(this.rightLegPivot, style.skirt ? skinMat : bottomMat, sockMat, shoeMat, soleMat);
    this.bodyPivot.add(this.leftLegPivot, this.rightLegPivot);

    // 2. Pelvis / Waist or Gently Flared Skirt (clean clearance over legs)
    if (style.skirt) {
      // Inner hip block keeps waist sealed when seated
      this.addCyl(this.bodyPivot, 0.118, 0.122, 0.09, 10, bottomMat, 0, 0.39, 0);
      const skirtGeo = this.trackGeo(new THREE.CylinderGeometry(0.13, 0.205, 0.21, 12));
      const skirt = new THREE.Mesh(skirtGeo, bottomMat);
      skirt.position.set(0, 0.335, 0);
      skirt.scale.set(1.04, 1, 0.92);
      skirt.castShadow = true;
      skirt.receiveShadow = true;
      this.bodyPivot.add(skirt);
    } else {
      const pelvisGeo = this.trackGeo(new THREE.CylinderGeometry(0.126, 0.132, 0.12, 10));
      const pelvis = new THREE.Mesh(pelvisGeo, bottomMat);
      pelvis.position.set(0, 0.385, 0);
      pelvis.scale.set(1.06, 1, 0.82);
      pelvis.castShadow = true;
      pelvis.receiveShadow = true;
      this.bodyPivot.add(pelvis);
    }

    // 3. Upper Body Pivot (hinged at waist y = 0.425 — firmly overlaps pelvis top so never detaches)
    this.torsoPivot.position.set(0, 0.425, 0);
    this.bodyPivot.add(this.torsoPivot);

    // Layered non-coplanar stylish outfit torso (strict max half-width <= 0.152)
    this.buildOutfit(style, topMat, topDarkMat, innerMat, bottomMat, accentMat, metalMat);

    // 4. Articulated Arms clearly outside torso/jacket (x = ±0.195, sleeve r = 0.039 -> 0.156 > 0.152)
    const sleeveMat =
      style.outfitStyle === 'chef_apron' ? topMat : topMat;
    this.leftArmPivot.position.set(-0.195, 0.265, 0);
    this.rightArmPivot.position.set(0.195, 0.265, 0);
    this.buildArm(this.leftArmPivot, sleeveMat, innerMat, skinMat, 1);
    this.buildArm(this.rightArmPivot, sleeveMat, innerMat, skinMat, -1);
    this.torsoPivot.add(this.leftArmPivot, this.rightArmPivot);

    // Soft shoulder connectors bridge torso (0.145) to arm pivot (0.195) cleanly without clipping
    this.addSphere(this.torsoPivot, 0.048, sleeveMat, -0.158, 0.265, 0, 1.15, 0.92, 0.95, 8);
    this.addSphere(this.torsoPivot, 0.048, sleeveMat, 0.158, 0.265, 0, 1.15, 0.92, 0.95, 8);

    // Torso accessories
    if (style.crossbodyBag) {
      this.buildCrossbodyBag(accentMat, metalMat);
    }
    if (style.toteBag) {
      this.buildCanvasTote(accentMat);
    }
    if (style.neckHeadphones) {
      this.buildNeckHeadphones(accentMat, topDarkMat);
    }

    // 5. Clean Neck bridging torso (y=0.31) to head base (y=0.37)
    this.addCyl(this.torsoPivot, 0.05, 0.056, 0.095, 8, skinMat, 0, 0.34, 0);

    // 6. Head Pivot (hinged at y = 0.375 in torsoPivot -> head center at world ~0.955, ideal for 3/4 portrait!)
    this.headPivot.position.set(0, 0.375, 0);
    this.torsoPivot.add(this.headPivot);

    // Rounded stylized head (headR = 0.155, front equator Z = 0.155 * 0.96 = 0.1488)
    const headGeo = this.trackGeo(new THREE.SphereGeometry(0.155, 14, 10));
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 0.155, 0);
    head.scale.set(1.0, 0.98, 0.96);
    head.castShadow = true;
    head.receiveShadow = true;
    this.headPivot.add(head);

    // Cute side ears (cleanly outside head X = ±0.155)
    const earGeo = this.trackGeo(new THREE.SphereGeometry(0.03, 7, 6));
    const leftEar = new THREE.Mesh(earGeo, skinMat);
    leftEar.position.set(-0.156, 0.148, -0.005);
    leftEar.scale.set(0.65, 1.0, 0.8);
    const rightEar = new THREE.Mesh(earGeo, skinMat);
    rightEar.position.set(0.156, 0.148, -0.005);
    rightEar.scale.set(0.65, 1.0, 0.8);
    this.headPivot.add(leftEar, rightEar);

    // Facial features strictly proud of skull surface (zero z-fighting at any angle!)
    // At eye level (x=±0.055, y=0.162), skull Z ≈ 0.138 -> eyes placed at z = 0.154
    const eyeGeo = this.trackGeo(new THREE.SphereGeometry(0.021, 8, 6));
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.055, 0.162, 0.152);
    leftEye.scale.set(0.9, 1.12, 0.52);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.055, 0.162, 0.152);
    rightEye.scale.set(0.9, 1.12, 0.52);
    this.headPivot.add(leftEye, rightEye);

    const shineGeo = this.trackGeo(new THREE.SphereGeometry(0.0062, 6, 4));
    const leftShine = new THREE.Mesh(shineGeo, eyeShineMat);
    leftShine.position.set(-0.048, 0.171, 0.163);
    const rightShine = new THREE.Mesh(shineGeo, eyeShineMat);
    rightShine.position.set(0.062, 0.171, 0.163);
    this.headPivot.add(leftShine, rightShine);

    // Eyebrows cleanly proud of forehead (skull Z ≈ 0.131 -> brows at z = 0.150)
    const browGeo = this.trackGeo(new THREE.BoxGeometry(0.042, 0.01, 0.01));
    const leftBrow = new THREE.Mesh(browGeo, hairMat);
    leftBrow.position.set(-0.055, 0.203, 0.15);
    leftBrow.rotation.z = 0.08;
    const rightBrow = new THREE.Mesh(browGeo, hairMat);
    rightBrow.position.set(0.055, 0.203, 0.15);
    rightBrow.rotation.z = -0.08;
    this.headPivot.add(leftBrow, rightBrow);

    // Rosy cheek blush cleanly proud of cheek surface (skull Z ≈ 0.118 -> blush at z = 0.134)
    const blushGeo = this.trackGeo(new THREE.SphereGeometry(0.02, 6, 4));
    const leftBlush = new THREE.Mesh(blushGeo, blushMat);
    leftBlush.position.set(-0.089, 0.128, 0.134);
    leftBlush.scale.set(1.25, 0.6, 0.35);
    const rightBlush = new THREE.Mesh(blushGeo, blushMat);
    rightBlush.position.set(0.089, 0.128, 0.134);
    rightBlush.scale.set(1.25, 0.6, 0.35);
    this.headPivot.add(leftBlush, rightBlush);

    // Friendly smile arc cleanly proud of chin/face (skull Z ≈ 0.142 -> mouth at z = 0.156)
    const mouthGeo = this.trackGeo(
      new THREE.TorusGeometry(0.022, 0.0052, 5, 10, Math.PI * 0.72),
    );
    this.mouthMesh = new THREE.Mesh(mouthGeo, eyeMat);
    this.mouthMesh.position.set(0, 0.115, 0.156);
    this.mouthMesh.rotation.z = Math.PI * 1.14;
    this.headPivot.add(this.mouthMesh);

    // 7. Modern Sculpted Hairstyle + Head Accessories (strictly outside headR = 0.155, clear of face!)
    this.buildHairstyle(style, hairMat, hairAccentMat, accentMat);
    if (style.glasses) {
      this.buildGlasses(metalMat);
    }
    if (style.sunglassesOnHead) {
      this.buildHeadSunglasses();
    }
    if (style.catEars) {
      this.buildCatEarHeadband(accentMat, innerMat);
    }
    if (style.wornHeadphones) {
      this.buildWornHeadphones(accentMat, topDarkMat);
    }

    // 8. Emoji-only emotion bubble (zero permanent name plate sprite!)
    this.root.add(this.speechBubble.sprite);
  }

  private resolveStyle(def: VisitorDef, variantIndex: VisitorVariantIndex): VariantStyle {
    const presets = ARCHETYPE_VARIANTS[def.id];
    if (presets) {
      return presets[variantIndex % 3];
    }
    const fallbackHairs: HairStyleId[] = ['bob', 'quiff', 'side_waves'];
    return {
      skin: ['#F6E0CE', '#E6BF9F', '#C6906F'][variantIndex % 3],
      hair: ['#4A3529', '#302A2E', '#6E4B35'][variantIndex % 3],
      top: def.color,
      inner: '#FAF3E8',
      bottom: '#5C6676',
      shoe: '#EFEAE2',
      accent: shadeHex(def.color, 0.85),
      hairStyle: fallbackHairs[variantIndex % 3],
      outfitStyle: 'cardigan',
    };
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /**
   * Always creates 100% opaque, depth-writing MeshStandardMaterial for solid character parts.
   */
  private makeMat(color: string | number, roughness = 0.8, metalness = 0.03): THREE.MeshStandardMaterial {
    return this.trackMat(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness,
        metalness,
        flatShading: true,
        transparent: false,
        depthWrite: true,
      }),
    );
  }

  private addBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addSphere(
    parent: THREE.Object3D,
    r: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    segs = 8,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(r, segs, Math.max(5, segs - 2))),
      mat,
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addCyl(
    parent: THREE.Object3D,
    rt: number,
    rb: number,
    h: number,
    segs: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotZ = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(rt, rb, h, segs)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, 0, rotZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildLeg(
    pivot: THREE.Group,
    legMat: THREE.Material,
    sockMat: THREE.Material,
    shoeMat: THREE.Material,
    soleMat: THREE.Material,
  ): void {
    // Rounded hip ball ensures leg stays seamlessly joined during walking & sitting
    this.addSphere(pivot, 0.054, legMat, 0, 0, 0, 1, 1, 1, 7);
    // Leg column (spans y = 0 down to -0.27)
    this.addCyl(pivot, 0.052, 0.044, 0.27, 8, legMat, 0, -0.135, 0);
    // Crisp sock cuff (non-coplanar radius 0.046)
    this.addCyl(pivot, 0.046, 0.046, 0.042, 8, sockMat, 0, -0.285, 0);
    // Sneaker upper + white sole (bottom rests cleanly at y = -0.36 -> world FLOOR_BASE_Y)
    this.addBox(pivot, 0.092, 0.06, 0.148, shoeMat, 0, -0.319, 0.024);
    this.addBox(pivot, 0.098, 0.022, 0.156, soleMat, 0, -0.349, 0.024);
    // Rounded toe cap (slightly proud of front shoe box)
    this.addSphere(pivot, 0.04, soleMat, 0, -0.326, 0.09, 1.04, 0.62, 0.68, 7);
  }

  private buildArm(
    pivot: THREE.Group,
    sleeveMat: THREE.Material,
    cuffMat: THREE.Material,
    skinMat: THREE.Material,
    sideSign: 1 | -1,
  ): void {
    pivot.rotation.z = sideSign * 0.08;
    // Shoulder cap (sleeve radius 0.039 clears torso cleanly at x = ±0.195)
    this.addSphere(pivot, 0.043, sleeveMat, 0, -0.008, 0, 1, 0.92, 1, 7);
    // Sleeve
    this.addCyl(pivot, 0.04, 0.036, 0.198, 8, sleeveMat, 0, -0.108, 0);
    // Cuff trim
    this.addCyl(pivot, 0.04, 0.04, 0.028, 8, cuffMat, 0, -0.214, 0);
    // Hand
    this.addSphere(pivot, 0.038, skinMat, 0, -0.252, 0.006, 0.95, 1.04, 0.95, 7);
  }

  /**
   * Builds strictly non-coplanar layered torso outfits with max half-width <= 0.150
   * so arms at x = ±0.195 never clip the body.
   */
  private buildOutfit(
    style: VariantStyle,
    topMat: THREE.Material,
    topDarkMat: THREE.Material,
    innerMat: THREE.Material,
    bottomMat: THREE.Material,
    accentMat: THREE.Material,
    metalMat: THREE.Material,
  ): void {
    const isLayeredOpen =
      style.outfitStyle === 'cardigan' ||
      style.outfitStyle === 'cardigan_scarf' ||
      style.outfitStyle === 'trench_crossbody' ||
      style.outfitStyle === 'bomber_jacket' ||
      style.outfitStyle === 'street_jacket' ||
      style.outfitStyle === 'corduroy_jacket';

    // Inner torso core: strictly smaller (w=0.236, h=0.292, d=0.156) than outer jacket panels!
    const coreMat = isLayeredOpen ? innerMat : topMat;
    const core = this.addBox(this.torsoPivot, 0.236, 0.292, 0.156, coreMat, 0, 0.156, 0);
    core.scale.set(1, 1, 1);

    const addOpenJacketShell = (
      h: number,
      yCenter: number,
      shellMat: THREE.Material,
      hemMat: THREE.Material,
    ) => {
      // Back jacket panel strictly behind core (z = -0.092, thickness 0.032 -> -0.108..-0.076)
      this.addBox(this.torsoPivot, 0.286, h, 0.038, shellMat, 0, yCenter, -0.09);
      // Left & right wrap panels strictly outside core X & front Z (non-coplanar heights!)
      this.addBox(this.torsoPivot, 0.094, h - 0.004, 0.194, shellMat, -0.098, yCenter, 0.002);
      this.addBox(this.torsoPivot, 0.094, h - 0.004, 0.194, shellMat, 0.098, yCenter, 0.002);
      // Subtle bottom hem band
      this.addBox(this.torsoPivot, 0.096, 0.026, 0.016, hemMat, -0.098, yCenter - h / 2 + 0.016, 0.096);
      this.addBox(this.torsoPivot, 0.096, 0.026, 0.016, hemMat, 0.098, yCenter - h / 2 + 0.016, 0.096);
    };

    switch (style.outfitStyle) {
      case 'cardigan':
      case 'cardigan_scarf': {
        addOpenJacketShell(0.304, 0.158, topMat, topDarkMat);
        // Proud buttons on right front panel
        this.addSphere(this.torsoPivot, 0.011, accentMat, 0.064, 0.205, 0.104, 1, 1, 0.6, 6);
        this.addSphere(this.torsoPivot, 0.011, accentMat, 0.064, 0.125, 0.104, 1, 1, 0.6, 6);

        if (style.outfitStyle === 'cardigan_scarf') {
          const scarfGeo = this.trackGeo(new THREE.TorusGeometry(0.082, 0.028, 7, 14));
          scarfGeo.rotateX(Math.PI / 2);
          const scarf = new THREE.Mesh(scarfGeo, accentMat);
          scarf.position.set(0, 0.318, 0.006);
          scarf.castShadow = true;
          this.torsoPivot.add(scarf);
          this.addBox(this.torsoPivot, 0.058, 0.14, 0.024, accentMat, 0.046, 0.225, 0.114, 0.08, 0, -0.08);
        }
        break;
      }

      case 'turtleneck': {
        this.addBox(this.torsoPivot, 0.268, 0.302, 0.184, topMat, 0, 0.158, 0);
        this.addCyl(this.torsoPivot, 0.072, 0.078, 0.07, 10, topMat, 0, 0.32, 0);
        this.addBox(this.torsoPivot, 0.274, 0.034, 0.19, topDarkMat, 0, 0.02, 0);
        break;
      }

      case 'trench_crossbody': {
        this.addCyl(this.torsoPivot, 0.068, 0.074, 0.062, 10, innerMat, 0, 0.316, 0);
        addOpenJacketShell(0.326, 0.148, topMat, topDarkMat);
        // Sculpted lapels cleanly proud of front panels
        this.addBox(this.torsoPivot, 0.05, 0.105, 0.018, topDarkMat, -0.074, 0.248, 0.106, 0, 0, -0.2);
        this.addBox(this.torsoPivot, 0.05, 0.105, 0.018, topDarkMat, 0.074, 0.248, 0.106, 0, 0, 0.2);
        break;
      }

      case 'oversized_sweater': {
        this.addBox(this.torsoPivot, 0.284, 0.304, 0.198, topMat, 0, 0.158, 0);
        this.addBox(this.torsoPivot, 0.29, 0.038, 0.204, topDarkMat, 0, 0.016, 0);
        this.addCyl(this.torsoPivot, 0.08, 0.086, 0.036, 10, innerMat, 0, 0.314, 0);
        // Proud cute emblem patch
        this.addSphere(this.torsoPivot, 0.022, accentMat, -0.064, 0.215, 0.106, 1.15, 0.9, 0.45, 7);
        break;
      }

      case 'bomber_jacket': {
        addOpenJacketShell(0.276, 0.172, topMat, innerMat);
        // Cropped varsity waist stripe cleanly wrapping bottom
        this.addBox(this.torsoPivot, 0.292, 0.032, 0.202, innerMat, 0, 0.044, -0.002);
        // Graphic tee block cleanly proud on inner shirt
        this.addBox(this.torsoPivot, 0.058, 0.064, 0.014, accentMat, 0, 0.185, 0.084);
        break;
      }

      case 'denim_overalls': {
        this.addBox(this.torsoPivot, 0.264, 0.298, 0.178, topMat, 0, 0.156, 0);
        // Overall bib & shoulder straps strictly outside tee (z = ±0.098)
        this.addBox(this.torsoPivot, 0.205, 0.195, 0.198, bottomMat, 0, 0.115, 0.004);
        this.addBox(this.torsoPivot, 0.034, 0.125, 0.2, bottomMat, -0.068, 0.254, 0.002);
        this.addBox(this.torsoPivot, 0.034, 0.125, 0.2, bottomMat, 0.068, 0.254, 0.002);
        // Front bib pocket & brass buttons proud of bib
        this.addBox(this.torsoPivot, 0.105, 0.07, 0.018, bottomMat, 0, 0.145, 0.108);
        this.addSphere(this.torsoPivot, 0.012, metalMat, -0.068, 0.208, 0.11, 1, 1, 0.5, 6);
        this.addSphere(this.torsoPivot, 0.012, metalMat, 0.068, 0.208, 0.11, 1, 1, 0.5, 6);
        break;
      }

      case 'linen_shirt': {
        this.addBox(this.torsoPivot, 0.276, 0.3, 0.19, topMat, 0, 0.156, 0);
        this.addBox(this.torsoPivot, 0.064, 0.05, 0.022, innerMat, -0.052, 0.285, 0.096, 0.15, 0, -0.24);
        this.addBox(this.torsoPivot, 0.064, 0.05, 0.022, innerMat, 0.052, 0.285, 0.096, 0.15, 0, 0.24);
        this.addBox(this.torsoPivot, 0.058, 0.064, 0.016, topDarkMat, -0.068, 0.198, 0.1);
        break;
      }

      case 'hoodie': {
        this.addBox(this.torsoPivot, 0.286, 0.306, 0.198, topMat, 0, 0.158, 0);
        // Kangaroo pocket proud of front
        this.addBox(this.torsoPivot, 0.18, 0.088, 0.022, topDarkMat, 0, 0.088, 0.106);
        // Drawstrings proud of chest
        this.addBox(this.torsoPivot, 0.011, 0.088, 0.011, innerMat, -0.032, 0.242, 0.106);
        this.addBox(this.torsoPivot, 0.011, 0.088, 0.011, innerMat, 0.032, 0.242, 0.106);
        // Folded hood neatly draped behind shoulders (never over head!)
        this.addBox(this.torsoPivot, 0.19, 0.08, 0.098, topDarkMat, 0, 0.285, -0.108, -0.32, 0, 0);
        break;
      }

      case 'street_jacket': {
        addOpenJacketShell(0.304, 0.158, topMat, topDarkMat);
        // Inner folded hood behind neck
        this.addBox(this.torsoPivot, 0.175, 0.072, 0.09, innerMat, 0, 0.288, -0.11, -0.3, 0, 0);
        break;
      }

      case 'chef_apron': {
        // Warm shirt underneath + crisp bistro/chef apron front & waist tie
        this.addBox(this.torsoPivot, 0.268, 0.298, 0.182, topMat, 0, 0.156, 0);
        // Apron bib + lower front panel strictly proud of front
        this.addBox(this.torsoPivot, 0.19, 0.275, 0.022, accentMat, 0, 0.132, 0.098);
        // Apron waist tie wrapping cleanly around waist
        this.addBox(this.torsoPivot, 0.278, 0.028, 0.194, accentMat, 0, 0.055, 0);
        // Front pocket & subtle stripe
        this.addBox(this.torsoPivot, 0.12, 0.068, 0.016, innerMat, 0, 0.115, 0.113);
        // Neck loop
        const loopGeo = this.trackGeo(new THREE.TorusGeometry(0.068, 0.01, 6, 12));
        loopGeo.rotateX(Math.PI / 2);
        const loop = new THREE.Mesh(loopGeo, accentMat);
        loop.position.set(0, 0.305, 0.01);
        this.torsoPivot.add(loop);
        break;
      }

      case 'studio_smock': {
        // Relaxed artist studio smock with scarf & paint-brush pocket
        this.addBox(this.torsoPivot, 0.282, 0.312, 0.194, topMat, 0, 0.152, 0);
        this.addBox(this.torsoPivot, 0.078, 0.078, 0.018, topDarkMat, 0.068, 0.115, 0.104);
        this.addBox(this.torsoPivot, 0.078, 0.078, 0.018, topDarkMat, -0.068, 0.115, 0.104);
        // Cute collar bow/scarf
        const ringGeo = this.trackGeo(new THREE.TorusGeometry(0.076, 0.02, 6, 12));
        ringGeo.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, accentMat);
        ring.position.set(0, 0.312, 0.006);
        this.torsoPivot.add(ring);
        break;
      }

      case 'corduroy_jacket': {
        addOpenJacketShell(0.304, 0.158, topMat, topDarkMat);
        // Cozy shearling/cream collar lapels
        this.addBox(this.torsoPivot, 0.054, 0.088, 0.02, innerMat, -0.075, 0.268, 0.104, 0, 0, -0.18);
        this.addBox(this.torsoPivot, 0.054, 0.088, 0.02, innerMat, 0.075, 0.268, 0.104, 0, 0, 0.18);
        break;
      }
    }
  }

  private buildCrossbodyBag(bagMat: THREE.Material, metalMat: THREE.Material): void {
    // Diagonal strap strictly proud of front/back coat
    this.addBox(this.torsoPivot, 0.024, 0.36, 0.222, bagMat, 0, 0.16, 0.002, 0, 0, -0.66);
    // Satchel resting neatly at right hip (behind/below arm swing)
    this.addBox(this.torsoPivot, 0.068, 0.11, 0.125, bagMat, 0.152, 0.01, -0.035);
    this.addBox(this.torsoPivot, 0.016, 0.022, 0.028, metalMat, 0.188, 0.028, -0.035);
  }

  private buildCanvasTote(toteMat: THREE.Material): void {
    // Tote bag tucked slightly behind left hip so left arm swings freely!
    this.addBox(this.torsoPivot, 0.062, 0.16, 0.148, toteMat, -0.152, 0.015, -0.042);
    this.addBox(this.torsoPivot, 0.016, 0.18, 0.018, toteMat, -0.145, 0.15, 0.005);
    this.addBox(this.torsoPivot, 0.016, 0.18, 0.018, toteMat, -0.145, 0.15, -0.085);
    // Tiny cute botanical sprig peeking out
    const leafMat = this.makeMat('#78B884', 0.8);
    this.addSphere(this.torsoPivot, 0.028, leafMat, -0.155, 0.115, -0.02, 0.7, 1.35, 0.9, 6);
    this.addSphere(this.torsoPivot, 0.025, leafMat, -0.158, 0.11, -0.06, 0.7, 1.25, 0.9, 6);
  }

  private buildNeckHeadphones(accentMat: THREE.Material, darkMat: THREE.Material): void {
    const bandGeo = this.trackGeo(new THREE.TorusGeometry(0.095, 0.014, 6, 14, Math.PI * 1.4));
    bandGeo.rotateX(Math.PI / 2);
    const band = new THREE.Mesh(bandGeo, darkMat);
    band.position.set(0, 0.312, -0.006);
    band.rotation.z = -Math.PI * 0.2;
    this.torsoPivot.add(band);
    this.addCyl(this.torsoPivot, 0.036, 0.036, 0.03, 10, accentMat, -0.084, 0.296, 0.082, 0.38, 0.38);
    this.addCyl(this.torsoPivot, 0.036, 0.036, 0.03, 10, accentMat, 0.084, 0.296, 0.082, 0.38, -0.38);
  }

  private buildWornHeadphones(accentMat: THREE.Material, darkMat: THREE.Material): void {
    const archGeo = this.trackGeo(new THREE.TorusGeometry(0.186, 0.014, 6, 16, Math.PI));
    const arch = new THREE.Mesh(archGeo, darkMat);
    arch.position.set(0, 0.17, 0);
    arch.castShadow = true;
    this.headPivot.add(arch);
    this.addCyl(this.headPivot, 0.044, 0.044, 0.034, 10, accentMat, -0.182, 0.152, 0, 0, Math.PI / 2);
    this.addCyl(this.headPivot, 0.044, 0.044, 0.034, 10, accentMat, 0.182, 0.152, 0, 0, Math.PI / 2);
  }

  private buildGlasses(frameMat: THREE.Material): void {
    // Cleanly proud at z = 0.172 (well clear of eyes at 0.163 & brows at 0.155)
    const lensGeo = this.trackGeo(new THREE.TorusGeometry(0.036, 0.0055, 6, 14));
    const left = new THREE.Mesh(lensGeo, frameMat);
    left.position.set(-0.055, 0.162, 0.172);
    const right = new THREE.Mesh(lensGeo, frameMat);
    right.position.set(0.055, 0.162, 0.172);
    this.headPivot.add(left, right);
    this.addBox(this.headPivot, 0.038, 0.007, 0.007, frameMat, 0, 0.165, 0.173);
    this.addBox(this.headPivot, 0.007, 0.007, 0.145, frameMat, -0.094, 0.164, 0.102);
    this.addBox(this.headPivot, 0.007, 0.007, 0.145, frameMat, 0.094, 0.164, 0.102);
  }

  private buildHeadSunglasses(): void {
    const frameMat = this.makeMat('#2F2824', 0.35, 0.2);
    const tintMat = this.makeMat('#4E3D35', 0.2, 0.3);
    this.addBox(this.headPivot, 0.068, 0.036, 0.016, tintMat, -0.046, 0.298, 0.078, -0.66, 0, 0);
    this.addBox(this.headPivot, 0.068, 0.036, 0.016, tintMat, 0.046, 0.298, 0.078, -0.66, 0, 0);
    this.addBox(this.headPivot, 0.154, 0.012, 0.018, frameMat, 0, 0.305, 0.072, -0.66, 0, 0);
  }

  private buildCatEarHeadband(accentMat: THREE.Material, innerEarMat: THREE.Material): void {
    const bandGeo = this.trackGeo(new THREE.TorusGeometry(0.184, 0.012, 6, 16, Math.PI));
    const band = new THREE.Mesh(bandGeo, accentMat);
    band.position.set(0, 0.185, 0.01);
    band.rotation.x = -0.08;
    this.headPivot.add(band);

    const earGeo = this.trackGeo(new THREE.ConeGeometry(0.045, 0.088, 4));
    const leftEar = new THREE.Mesh(earGeo, accentMat);
    leftEar.position.set(-0.098, 0.368, 0.018);
    leftEar.rotation.set(0.1, Math.PI / 4, 0.28);
    leftEar.castShadow = true;

    const rightEar = new THREE.Mesh(earGeo, accentMat);
    rightEar.position.set(0.098, 0.368, 0.018);
    rightEar.rotation.set(0.1, Math.PI / 4, -0.28);
    rightEar.castShadow = true;

    const innerGeo = this.trackGeo(new THREE.ConeGeometry(0.024, 0.048, 4));
    const leftIn = new THREE.Mesh(innerGeo, innerEarMat);
    leftIn.position.set(-0.096, 0.362, 0.04);
    leftIn.rotation.set(0.12, Math.PI / 4, 0.28);
    const rightIn = new THREE.Mesh(innerGeo, innerEarMat);
    rightIn.position.set(0.096, 0.362, 0.04);
    rightIn.rotation.set(0.12, Math.PI / 4, -0.28);

    this.headPivot.add(leftEar, rightEar, leftIn, rightIn);
  }

  /**
   * Builds sculpted modern hairstyles cleanly outside `headR = 0.155` and clear of face plane `z > 0.10`.
   */
  private buildHairstyle(
    style: VariantStyle,
    hairMat: THREE.Material,
    hairAccentMat: THREE.Material,
    accentMat: THREE.Material,
  ): void {
    const h = this.headPivot;
    // Outer scalp dome offset cleanly behind face (r = 0.166 > 0.155, z = -0.036 -> front <= 0.10)
    const addCrownBase = (mat: THREE.Material = hairMat, topLift = 0.0) => {
      this.addSphere(h, 0.166, mat, 0, 0.184 + topLift, -0.036, 1.04, 0.9, 0.96, 10);
      this.addSphere(h, 0.15, mat, 0, 0.132, -0.068, 1.06, 0.92, 0.84, 9);
    };

    switch (style.hairStyle) {
      case 'bob': {
        addCrownBase();
        this.addBox(h, 0.052, 0.21, 0.14, hairMat, -0.152, 0.115, -0.02, 0, 0, 0.05);
        this.addBox(h, 0.052, 0.21, 0.14, hairMat, 0.152, 0.115, -0.02, 0, 0, -0.05);
        this.addBox(h, 0.256, 0.2, 0.08, hairMat, 0, 0.108, -0.138);
        this.addBox(h, 0.115, 0.054, 0.048, hairMat, -0.052, 0.254, 0.116, 0.24, 0, 0.18);
        this.addBox(h, 0.115, 0.054, 0.048, hairMat, 0.055, 0.254, 0.116, 0.24, 0, -0.18);
        break;
      }

      case 'fringe_messy': {
        addCrownBase(hairMat, 0.01);
        this.addSphere(h, 0.066, hairMat, -0.068, 0.285, 0.052, 1.2, 0.72, 1.0, 7);
        this.addSphere(h, 0.064, hairMat, 0.045, 0.292, 0.042, 1.1, 0.76, 1.0, 7);
        this.addBox(h, 0.145, 0.058, 0.046, hairMat, -0.028, 0.25, 0.124, 0.2, 0.1, 0.22);
        this.addBox(h, 0.082, 0.048, 0.044, hairMat, 0.072, 0.248, 0.118, 0.18, -0.12, -0.2);
        this.addBox(h, 0.038, 0.105, 0.068, hairMat, -0.152, 0.16, -0.005);
        this.addBox(h, 0.038, 0.105, 0.068, hairMat, 0.152, 0.16, -0.005);
        break;
      }

      case 'high_bun': {
        addCrownBase();
        this.addSphere(h, 0.078, hairMat, 0, 0.348, -0.048, 1.05, 0.92, 1.05, 9);
        const tieGeo = this.trackGeo(new THREE.TorusGeometry(0.064, 0.015, 6, 12));
        tieGeo.rotateX(Math.PI / 2);
        const tie = new THREE.Mesh(tieGeo, accentMat);
        tie.position.set(0, 0.308, -0.048);
        h.add(tie);
        this.addBox(h, 0.028, 0.105, 0.03, hairMat, -0.138, 0.165, 0.068, 0.1, 0, 0.12);
        this.addBox(h, 0.028, 0.105, 0.03, hairMat, 0.138, 0.165, 0.068, 0.1, 0, -0.12);
        break;
      }

      case 'quiff': {
        addCrownBase(hairMat, 0.006);
        this.addSphere(h, 0.086, hairMat, -0.008, 0.298, 0.068, 1.32, 0.76, 1.12, 8);
        this.addSphere(h, 0.068, hairMat, 0.062, 0.28, 0.04, 1.0, 0.72, 1.0, 7);
        this.addBox(h, 0.03, 0.08, 0.08, hairMat, -0.152, 0.195, -0.015);
        this.addBox(h, 0.03, 0.08, 0.08, hairMat, 0.152, 0.195, -0.015);
        break;
      }

      case 'side_waves': {
        addCrownBase();
        this.addSphere(h, 0.082, hairMat, -0.072, 0.272, 0.068, 1.3, 0.68, 0.98, 8);
        this.addSphere(h, 0.064, hairMat, 0.082, 0.262, 0.052, 1.0, 0.65, 0.88, 7);
        this.addSphere(h, 0.064, hairMat, -0.154, 0.12, -0.025, 0.74, 1.5, 1.05, 8);
        this.addSphere(h, 0.064, hairMat, 0.154, 0.105, -0.025, 0.74, 1.6, 1.05, 8);
        this.addSphere(h, 0.118, hairMat, 0, 0.055, -0.128, 1.32, 1.02, 0.72, 8);
        break;
      }

      case 'chic_crop': {
        addCrownBase(hairMat, -0.004);
        this.addBox(h, 0.2, 0.044, 0.062, hairMat, -0.01, 0.265, 0.088, 0.22, 0.08, 0.1);
        this.addBox(h, 0.03, 0.085, 0.078, hairMat, -0.152, 0.19, -0.018);
        this.addBox(h, 0.03, 0.085, 0.078, hairMat, 0.152, 0.19, -0.018);
        break;
      }

      case 'tapered_fade': {
        // Crisp short fade with neat contoured top
        this.addSphere(h, 0.16, hairMat, 0, 0.178, -0.038, 1.01, 0.86, 0.94, 9);
        this.addBox(h, 0.21, 0.062, 0.205, hairMat, 0, 0.285, -0.005);
        this.addBox(h, 0.19, 0.032, 0.05, hairMat, 0, 0.266, 0.092, 0.15, 0, 0);
        break;
      }

      case 'short_curls': {
        addCrownBase(hairMat, 0.004);
        const curls: [number, number, number, number][] = [
          [-0.07, 0.292, 0.055, 0.062],
          [0.01, 0.304, 0.06, 0.066],
          [0.08, 0.286, 0.045, 0.06],
          [-0.125, 0.255, 0.01, 0.058],
          [0.125, 0.255, 0.01, 0.058],
          [-0.05, 0.298, -0.045, 0.066],
          [0.06, 0.295, -0.045, 0.066],
        ];
        for (const [x, y, z, r] of curls) {
          this.addSphere(h, r, hairMat, x, y, z, 1, 0.92, 1, 7);
        }
        break;
      }

      case 'short_wavy': {
        addCrownBase(hairMat, 0.008);
        this.addSphere(h, 0.078, hairMat, -0.045, 0.288, 0.062, 1.3, 0.72, 1.0, 8);
        this.addSphere(h, 0.07, hairMat, 0.07, 0.278, 0.045, 1.1, 0.7, 0.95, 7);
        this.addBox(h, 0.038, 0.095, 0.085, hairMat, -0.152, 0.18, -0.018);
        this.addBox(h, 0.038, 0.095, 0.085, hairMat, 0.152, 0.18, -0.018);
        break;
      }

      case 'curly_puff': {
        addCrownBase(hairMat, 0.008);
        const puffs: [number, number, number, number][] = [
          [-0.14, 0.235, 0.008, 0.072],
          [0.14, 0.235, 0.008, 0.072],
          [-0.158, 0.14, -0.025, 0.07],
          [0.158, 0.14, -0.025, 0.07],
          [-0.078, 0.285, 0.052, 0.07],
          [0.078, 0.285, 0.052, 0.07],
          [0, 0.3, 0.005, 0.074],
          [-0.1, 0.12, -0.132, 0.076],
          [0.1, 0.12, -0.132, 0.076],
          [0, 0.18, -0.146, 0.08],
        ];
        for (const [x, y, z, r] of puffs) {
          this.addSphere(h, r, hairMat, x, y, z, 1, 1, 1, 7);
        }
        break;
      }

      case 'twin_buns': {
        addCrownBase();
        this.addBox(h, 0.108, 0.05, 0.046, hairMat, -0.052, 0.252, 0.118, 0.24, 0, 0.22);
        this.addBox(h, 0.108, 0.05, 0.046, hairMat, 0.052, 0.252, 0.118, 0.24, 0, -0.22);
        this.addSphere(h, 0.074, hairMat, -0.142, 0.315, -0.022, 1, 0.96, 1, 8);
        this.addSphere(h, 0.074, hairMat, 0.142, 0.315, -0.022, 1, 0.96, 1, 8);
        if (style.ribbonBows) {
          this.addBox(h, 0.052, 0.024, 0.022, accentMat, -0.142, 0.272, 0.044, 0, 0, 0.25);
          this.addBox(h, 0.052, 0.024, 0.022, accentMat, 0.142, 0.272, 0.044, 0, 0, -0.25);
        }
        break;
      }

      case 'long_waves': {
        addCrownBase();
        this.addBox(h, 0.108, 0.052, 0.048, hairMat, -0.055, 0.254, 0.118, 0.22, 0, 0.2);
        this.addBox(h, 0.108, 0.052, 0.048, hairMat, 0.055, 0.254, 0.118, 0.22, 0, -0.2);
        this.addSphere(h, 0.064, hairMat, -0.154, 0.065, -0.02, 0.72, 2.0, 0.98, 8);
        this.addSphere(h, 0.064, hairMat, 0.154, 0.065, -0.02, 0.72, 2.0, 0.98, 8);
        this.addBox(h, 0.28, 0.32, 0.085, hairMat, 0, 0.025, -0.14, 0.08, 0, 0);
        break;
      }

      case 'spiky': {
        addCrownBase(hairMat, 0.008);
        const spikes: [number, number, number, number, number, number][] = [
          [0, 0.34, 0.035, 0.35, 0, 0],
          [-0.072, 0.326, 0.045, 0.3, 0, 0.35],
          [0.072, 0.326, 0.045, 0.3, 0, -0.35],
          [-0.048, 0.335, -0.045, -0.25, 0, 0.22],
          [0.048, 0.335, -0.045, -0.25, 0, -0.22],
          [0, 0.312, 0.102, 0.62, 0, 0],
        ];
        const spikeGeo = this.trackGeo(new THREE.ConeGeometry(0.044, 0.108, 5));
        for (const [x, y, z, rx, ry, rz] of spikes) {
          const sp = new THREE.Mesh(spikeGeo, hairMat);
          sp.position.set(x, y, z);
          sp.rotation.set(rx, ry, rz);
          sp.castShadow = true;
          h.add(sp);
        }
        break;
      }

      case 'high_ponytail': {
        addCrownBase();
        this.addBox(h, 0.118, 0.048, 0.044, hairMat, -0.042, 0.258, 0.116, 0.22, 0, 0.2);
        const tieGeo = this.trackGeo(new THREE.TorusGeometry(0.052, 0.015, 6, 12));
        const tie = new THREE.Mesh(tieGeo, accentMat);
        tie.position.set(0, 0.282, -0.156);
        tie.rotation.x = 0.7;
        h.add(tie);
        this.addSphere(h, 0.07, hairMat, 0, 0.242, -0.214, 0.9, 1.32, 1.12, 8);
        this.addSphere(h, 0.058, hairMat, 0, 0.126, -0.238, 0.82, 1.42, 0.92, 8);
        break;
      }

      case 'pastel_fade': {
        this.addSphere(h, 0.162, hairMat, 0, 0.172, -0.038, 1.02, 0.84, 0.96, 9);
        this.addSphere(h, 0.094, hairAccentMat, -0.038, 0.288, 0.042, 1.2, 0.72, 1.12, 8);
        this.addSphere(h, 0.084, hairAccentMat, 0.052, 0.29, 0.022, 1.14, 0.74, 1.08, 8);
        this.addSphere(h, 0.078, hairAccentMat, 0, 0.286, -0.058, 1.32, 0.68, 0.98, 8);
        break;
      }

      case 'shoulder_waves': {
        addCrownBase();
        this.addBox(h, 0.11, 0.052, 0.048, hairMat, -0.055, 0.254, 0.116, 0.24, 0, 0.2);
        this.addBox(h, 0.11, 0.052, 0.048, hairMat, 0.055, 0.254, 0.116, 0.24, 0, -0.2);
        this.addSphere(h, 0.064, hairMat, -0.154, 0.105, -0.018, 0.74, 1.6, 1.02, 8);
        this.addSphere(h, 0.064, hairMat, 0.154, 0.105, -0.018, 0.74, 1.6, 1.02, 8);
        this.addSphere(h, 0.125, hairMat, 0, 0.075, -0.128, 1.24, 1.12, 0.72, 8);
        break;
      }

      case 'top_knot': {
        addCrownBase();
        this.addSphere(h, 0.072, hairMat, 0.008, 0.348, -0.028, 1.04, 0.95, 1.04, 8);
        this.addSphere(h, 0.044, hairMat, -0.032, 0.336, -0.042, 1, 0.85, 1, 7);
        this.addBox(h, 0.03, 0.112, 0.03, hairMat, -0.142, 0.16, 0.062, 0.12, 0, 0.12);
        this.addBox(h, 0.03, 0.112, 0.03, hairMat, 0.142, 0.16, 0.062, 0.12, 0, -0.12);
        break;
      }

      case 'natural_curls': {
        const curls: [number, number, number, number][] = [
          [0, 0.298, -0.006, 0.092],
          [-0.092, 0.288, 0.028, 0.085],
          [0.092, 0.288, 0.028, 0.085],
          [-0.154, 0.212, -0.01, 0.082],
          [0.154, 0.212, -0.01, 0.082],
          [-0.148, 0.12, -0.055, 0.078],
          [0.148, 0.12, -0.055, 0.078],
          [-0.078, 0.246, -0.112, 0.088],
          [0.078, 0.246, -0.112, 0.088],
          [0, 0.15, -0.148, 0.092],
          [0, 0.28, 0.076, 0.068],
        ];
        for (const [x, y, z, r] of curls) {
          this.addSphere(h, r, hairMat, x, y, z, 1, 1, 1, 7);
        }
        break;
      }

      case 'tousled_fringe': {
        addCrownBase(hairMat, 0.006);
        this.addBox(h, 0.172, 0.06, 0.052, hairMat, -0.018, 0.246, 0.122, 0.24, 0.08, 0.12);
        this.addBox(h, 0.09, 0.054, 0.046, hairMat, 0.082, 0.244, 0.114, 0.22, -0.14, -0.18);
        this.addBox(h, 0.038, 0.118, 0.082, hairMat, -0.152, 0.16, -0.015);
        this.addBox(h, 0.038, 0.118, 0.082, hairMat, 0.152, 0.16, -0.015);
        break;
      }

      case 'sleek_long_bob': {
        addCrownBase();
        this.addBox(h, 0.048, 0.255, 0.142, hairMat, -0.154, 0.098, -0.018);
        this.addBox(h, 0.048, 0.255, 0.142, hairMat, 0.154, 0.098, -0.018);
        this.addBox(h, 0.268, 0.25, 0.08, hairMat, 0, 0.098, -0.14);
        this.addBox(h, 0.108, 0.046, 0.046, hairMat, -0.058, 0.258, 0.112, 0.2, 0, 0.15);
        this.addBox(h, 0.108, 0.046, 0.046, hairMat, 0.058, 0.258, 0.112, 0.2, 0, -0.15);
        break;
      }

      case 'undercut': {
        this.addSphere(h, 0.158, hairMat, 0, 0.175, -0.04, 1.01, 0.82, 0.94, 9);
        this.addBox(h, 0.18, 0.072, 0.22, hairMat, 0, 0.288, -0.008, -0.14, 0, 0);
        this.addSphere(h, 0.072, hairMat, 0, 0.284, 0.072, 1.22, 0.65, 0.92, 7);
        break;
      }
    }
  }

  /**
   * Smooth scale-in / scale-out pop for spawn and departure — keeps all character
   * materials 100% opaque so zero transparency sorting / inside-out glitches occur.
   */
  setScalePop(scale: number): void {
    const s = Math.max(0.01, Math.min(1.08, scale));
    this.root.scale.setScalar(s);
  }

  updateAnimation(dt: number, pose: VisitorPose, walkSpeed = 1.45): void {
    this.speechBubble.update(dt);

    // Subtle mouth & head chatter while audible blabber plays
    if (this.speechBubble.isBlabbering()) {
      this.blabberPhase += dt * 16;
      const chatter = 0.5 + 0.5 * Math.sin(this.blabberPhase);
      this.mouthMesh.scale.set(1 + chatter * 0.22, 0.82 + chatter * 0.85, 1);
    } else {
      this.mouthMesh.scale.set(1, 1, 1);
    }

    const headChatterTilt = this.speechBubble.isBlabbering()
      ? Math.sin(this.blabberPhase * 0.45) * 0.05
      : 0;

    switch (pose) {
      case 'walk': {
        this.animPhase += dt * walkSpeed * 6.5;
        const stride = Math.sin(this.animPhase);
        const maxStride = this.wearsSkirt ? 0.31 : 0.38;
        const hop = Math.abs(stride) * 0.042;

        this.bodyPivot.position.y = FLOOR_BASE_Y + hop;
        this.leftLegPivot.rotation.set(stride * maxStride, 0, 0);
        this.rightLegPivot.rotation.set(-stride * maxStride, 0, 0);

        this.torsoPivot.rotation.set(0.045, stride * 0.05, stride * 0.025);
        this.leftArmPivot.rotation.set(-stride * 0.38, 0, 0.08);
        this.rightArmPivot.rotation.set(stride * 0.38, 0, -0.08);
        this.headPivot.rotation.set(-0.02 + headChatterTilt, 0, -stride * 0.02);
        break;
      }

      case 'sit': {
        this.animPhase += dt * 2.1;
        const breathe = Math.abs(Math.sin(this.animPhase)) * 0.006;

        // Seated drop keeps sneakers & heels cleanly above FLOOR_BASE_Y at every frame
        this.bodyPivot.position.y = FLOOR_BASE_Y - 0.068 + breathe;
        this.leftLegPivot.rotation.set(-0.98, 0.06, 0);
        this.rightLegPivot.rotation.set(-0.98, -0.06, 0);

        this.torsoPivot.rotation.set(-0.06, 0, 0);
        this.leftArmPivot.rotation.set(-0.36, 0, 0.12);
        this.rightArmPivot.rotation.set(-0.36, 0, -0.12);
        this.headPivot.rotation.set(0.04 + headChatterTilt, Math.sin(this.animPhase * 0.5) * 0.1, 0);
        break;
      }

      case 'dance': {
        this.animPhase += dt * 7.2;
        const beat = Math.sin(this.animPhase);
        const halfBeat = Math.sin(this.animPhase * 0.5);
        const bounce = Math.abs(beat) * 0.085;

        this.bodyPivot.position.y = FLOOR_BASE_Y + bounce;
        this.leftLegPivot.rotation.set(beat * 0.2, 0, 0.04);
        this.rightLegPivot.rotation.set(-beat * 0.2, 0, -0.04);

        this.torsoPivot.rotation.set(0.04, halfBeat * 0.2, halfBeat * 0.1);
        this.leftArmPivot.rotation.set(-0.92 + beat * 0.4, 0, 0.22);
        this.rightArmPivot.rotation.set(-0.92 - beat * 0.4, 0, -0.22);
        this.headPivot.rotation.set(
          Math.abs(beat) * 0.07 + headChatterTilt,
          -halfBeat * 0.12,
          halfBeat * 0.07,
        );
        break;
      }

      case 'pet': {
        this.animPhase += dt * 5.0;
        const stroke = Math.sin(this.animPhase);

        // Keep feet planted cleanly on FLOOR_BASE_Y while leaning smoothly from the waist
        this.bodyPivot.position.y = FLOOR_BASE_Y;
        this.leftLegPivot.rotation.set(0, 0, 0);
        this.rightLegPivot.rotation.set(0, 0, 0);

        this.torsoPivot.rotation.set(0.28 + stroke * 0.035, 0, 0);
        this.leftArmPivot.rotation.set(-0.68 + stroke * 0.16, 0, 0.08);
        this.rightArmPivot.rotation.set(-0.76 - stroke * 0.18, 0, -0.08);
        this.headPivot.rotation.set(0.16 + headChatterTilt, stroke * 0.05, 0);
        break;
      }

      case 'admire': {
        this.animPhase += dt * 2.5;
        const sway = Math.sin(this.animPhase * 0.6);

        this.bodyPivot.position.y = FLOOR_BASE_Y + Math.abs(Math.sin(this.animPhase)) * 0.008;
        this.leftLegPivot.rotation.set(0, 0, 0);
        this.rightLegPivot.rotation.set(0, 0, 0);

        this.torsoPivot.rotation.set(0.035, sway * 0.07, 0);
        this.leftArmPivot.rotation.set(-0.08, 0, 0.08);
        this.rightArmPivot.rotation.set(-0.32 + Math.sin(this.animPhase) * 0.07, 0, -0.08);
        this.headPivot.rotation.set(-0.03 + headChatterTilt, sway * 0.12, sway * 0.03);
        break;
      }

      case 'idle':
      default: {
        this.animPhase += dt * 2.0;
        const breathe = Math.abs(Math.sin(this.animPhase)) * 0.006;

        this.bodyPivot.position.y = FLOOR_BASE_Y + breathe;
        this.leftLegPivot.rotation.set(0, 0, 0);
        this.rightLegPivot.rotation.set(0, 0, 0);

        this.torsoPivot.rotation.set(0, 0, 0);
        this.leftArmPivot.rotation.set(0, 0, 0.08);
        this.rightArmPivot.rotation.set(0, 0, -0.08);
        this.headPivot.rotation.set(
          headChatterTilt,
          Math.sin(this.animPhase * 0.55) * 0.11,
          0,
        );
        break;
      }
    }
  }

  dispose(): void {
    this.speechBubble.dispose();
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}
