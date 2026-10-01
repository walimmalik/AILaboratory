import {
  defineKind,
  type KindCheck,
  LiquidTypeAttributes,
  LotAttributes,
  ProductAttributes,
} from '@ailab/schema';
import { memoryLinks } from '../memory/links.ts';
import { liquidKinds } from './liquid-kinds.ts';

const PLAN = 'Reagents and liquids (plan 009)';

const productChecks: KindCheck<ProductAttributes>[] = [
  {
    id: 'made_has_recipe',
    label: 'A lab-made product has its recipe; a bought one has none',
    severity: 'blocker',
    source: `${PLAN}, R3: lab-made solutions trace back to the lots they were made from`,
    section: 'contents',
    fix: 'Add the recipe (what goes into a batch and what it yields), or set it to bought',
    test: (a) =>
      a.origin === 'made'
        ? a.recipe !== undefined || 'Made in the lab, but no recipe'
        : a.recipe === undefined || 'Bought, but it has a recipe',
  },
  {
    id: 'lot_fields_unique',
    label: 'Lot fields have unique keys',
    severity: 'blocker',
    source: `${PLAN}, R9: SOP variables link to a lot field by its key`,
    section: 'contents',
    fix: 'Rename the repeated key',
    test: (a) => {
      const keys = (a.lotFields ?? []).map((f) => f.key);
      const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
      return repeated.length === 0 || `${[...new Set(repeated)].join(', ')} appears twice`;
    },
  },
  {
    id: 'vendor_known',
    label: 'Vendor and catalog number are known',
    severity: 'warning',
    source: `${PLAN}: reordering and datasheets go by vendor and catalog number`,
    section: 'identity',
    fix: 'Add the vendor and at least one catalog number',
    test: (a) =>
      a.origin === 'made' ||
      (a.vendor !== undefined && (a.catalog?.length ?? 0) > 0) ||
      'Vendor or catalog number is missing',
  },
  {
    id: 'storage_known',
    label: 'Storage temperature is known',
    severity: 'warning',
    source: `${PLAN}: inventory (010) places containers by storage temperature`,
    section: 'handling',
    fix: 'Add the storage temperature from the datasheet',
    test: (a) => a.storage !== undefined || 'Not given',
  },
  {
    id: 'liquid_type_known',
    label: 'Liquid type is set',
    severity: 'warning',
    source: `${PLAN}, R4: the liquid type picks the liquid class on every instrument`,
    section: 'handling',
    fix: 'Choose how it pipettes (aqueous, DMSO, glycerol…)',
    test: (a) =>
      a.form === 'kit' ||
      a.category === 'purification_kit' ||
      (a.form !== undefined && a.form !== 'liquid' && a.form !== 'frozen_liquid') ||
      a.liquidType !== undefined ||
      'Not set',
  },
  {
    id: 'hazards_known',
    label: 'Hazards are known',
    severity: 'warning',
    source: `${PLAN}: GHS codes and the safety data sheet`,
    section: 'handling',
    fix: 'Add the GHS codes or a summary, and the SDS link',
    test: (a) => a.origin === 'made' || a.hazards !== undefined || 'Not given',
  },
];

/** A product the lab buys or makes (R1 to R3): a reagent, a kit of component products, a recipe. */
export const product = defineKind({
  kind: 'product',
  idPrefix: 'prd',
  namePrefix: 'PRD',
  nameWidth: 4,
  attributes: ProductAttributes,
  links: (a) => [
    ...(a.vendor ? [{ toId: a.vendor, relation: 'sold_by' }] : []),
    ...(a.catalog ?? []).flatMap((c) =>
      c.supplier ? [{ toId: c.supplier, relation: 'supplied_by' }] : [],
    ),
    ...(a.liquidType ? [{ toId: a.liquidType, relation: 'pipettes_as' }] : []),
    ...(a.liquidClasses ?? []).map((c) => ({ toId: c, relation: 'uses_class' })),
    ...(a.components ?? []).map((c) => ({ toId: c.product, relation: 'has_component' })),
    ...(a.recipe?.components ?? []).map((c) => ({ toId: c.product, relation: 'made_from' })),
    ...memoryLinks(a.handlingRules),
  ],
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: ['category', 'origin', 'vendor', 'catalog', 'form', 'datasheets', 'notes'],
    },
    {
      id: 'contents',
      title: 'Contents',
      fields: [
        'composition',
        'concentration',
        'molarMass',
        'cas',
        'components',
        'recipe',
        'lotFields',
      ],
    },
    {
      id: 'handling',
      title: 'Storage and handling',
      fields: ['storage', 'shelfLife', 'liquidType', 'liquidClasses', 'handlingRules', 'hazards'],
    },
  ],
  checks: productChecks,
  notApplicable: (a) => [
    ...(a.origin === 'made' ? ['vendor', 'catalog', 'components'] : ['recipe']),
  ],
});

/** A lot of a product (R1): lot number, expiry and certificate values. */
export const lot = defineKind({
  kind: 'lot',
  idPrefix: 'lot',
  namePrefix: 'LOT',
  nameWidth: 4,
  attributes: LotAttributes,
  links: (a) => [
    { toId: a.product, relation: 'lot_of' },
    ...(a.componentLots ?? []).map((l) => ({ toId: l, relation: 'uses_lot' })),
  ],
  checks: [
    {
      id: 'expiry_known',
      label: 'Expiry date is known',
      severity: 'warning',
      source: `${PLAN}, R10: expired lots need a reason to be used`,
      fix: 'Add the expiry date from the label or certificate',
      test: (a) => a.expiry !== undefined || 'Not given',
    },
  ],
});

/** How a liquid behaves when pipetted, whatever the instrument (R4). */
export const liquidType = defineKind({
  kind: 'liquid_type',
  idPrefix: 'lqt',
  namePrefix: 'LQT',
  nameWidth: 4,
  attributes: LiquidTypeAttributes,
});

export const reagentKinds = [product, lot, liquidType, ...liquidKinds];
