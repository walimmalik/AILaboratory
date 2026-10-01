import {
  defineKind,
  type KindCheck,
  LiquidClassAttributes,
  VerificationAttributes,
} from '@ailab/schema';

const classChecks: KindCheck<LiquidClassAttributes>[] = [
  {
    id: 'platform_fits',
    label: 'The platform settings fit what the class is for',
    severity: 'blocker',
    source: `One class is for one device, tip or source plate (plan 009 R5 and R7, reagents and liquids)`,
    section: 'use',
    fix: 'Name the source plate type for an Echo class, and the tips for an Opentrons or Hamilton class',
    test: (a) => {
      const { platform } = a.settings;
      if (platform === 'echo' && !a.sourceLabware)
        return 'An Echo class names its source plate type';
      if (platform === 'echo' && !a.platformName)
        return 'An Echo class has its full name, e.g. 384PP_DMSO2';
      if (platform === 'opentrons' && !a.device) return 'An Opentrons class names its pipette';
      return true;
    },
  },
  {
    id: 'venus_matches',
    label: 'The copy matches what Venus runs',
    severity: 'warning',
    source: `Venus classes edited here must be applied in Venus (plan 009 R5, reagents and liquids)`,
    section: 'platform',
    fix: 'Apply the change in Venus, then re-import the class',
    test: (a) =>
      a.settings.platform !== 'hamilton' ||
      !a.settings.changedHere ||
      'Changed here, apply in Venus',
  },
  {
    id: 'volume_known',
    label: 'The volume range is known',
    severity: 'warning',
    source: `Accuracy changes with volume (plan 009 R7, reagents and liquids)`,
    section: 'use',
    fix: 'Add the smallest and largest volume it is meant for',
    test: (a) => (a.volume?.min && a.volume?.max ? true : 'Not given'),
  },
];

/** How one device pipettes one kind of liquid (R4, R5, R7). */
export const liquidClass = defineKind({
  kind: 'liquid_class',
  idPrefix: 'lqc',
  namePrefix: 'LQC',
  nameWidth: 4,
  attributes: LiquidClassAttributes,
  links: (a) => [
    { toId: a.instrumentKind, relation: 'runs_on' },
    ...(a.device ? [{ toId: a.device, relation: 'for_device' }] : []),
    ...(a.tips ?? []).map((t) => ({ toId: t, relation: 'for_tips' })),
    ...(a.sourceLabware ? [{ toId: a.sourceLabware, relation: 'for_source_plate' }] : []),
    ...a.liquidTypes.map((t) => ({ toId: t, relation: 'serves' })),
  ],
  sections: [
    {
      id: 'use',
      title: 'What it is for',
      fields: [
        'instrumentKind',
        'device',
        'tips',
        'sourceLabware',
        'mode',
        'volume',
        'liquidTypes',
        'labDefault',
      ],
    },
    {
      id: 'platform',
      title: 'Platform settings',
      fields: ['platformName', 'origin', 'settings', 'notes'],
    },
  ],
  checks: classChecks,
});

/** A gravimetric, dye or photometric check of a liquid class (R11). */
export const liquidClassVerification = defineKind({
  kind: 'liquid_class_verification',
  idPrefix: 'lqv',
  namePrefix: 'LQV',
  nameWidth: 4,
  attributes: VerificationAttributes,
  links: (a) => [
    { toId: a.liquidClass, relation: 'verifies' },
    ...(a.instrument ? [{ toId: a.instrument, relation: 'ran_on' }] : []),
  ],
});

export const liquidKinds = [liquidClass, liquidClassVerification];
