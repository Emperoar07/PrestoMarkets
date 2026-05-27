import type { MarketType, ResolutionMode } from './markets';

export type MarketTemplate = {
  id: string;
  type: MarketType;
  category: string;
  title: string;
  question: string;
  rules: string;
  sourceOfTruth: string;
  resolutionMode: ResolutionMode;
  closeHint: string;
};

export const marketTemplates: MarketTemplate[] = [
  {
    id: 'macro-release',
    type: 'Prediction',
    category: 'Macro',
    title: 'Macro release',
    question: 'Will the next US CPI print come in above consensus?',
    rules: 'YES wins if the official CPI print is higher than the published consensus estimate at release time. NO wins otherwise.',
    sourceOfTruth: 'Official government release and a named public consensus source.',
    resolutionMode: 'Human resolver',
    closeHint: 'Close before the scheduled data release.',
  },
  {
    id: 'policy-signal',
    type: 'Prediction',
    category: 'Policy',
    title: 'Policy signal',
    question: 'Will a named policy decision be announced before the deadline?',
    rules: 'YES wins if the named institution publicly announces the decision before the close time. NO wins if no qualifying announcement is made.',
    sourceOfTruth: 'Official policy announcement, regulator publication, or verified public statement.',
    resolutionMode: 'Human resolver',
    closeHint: 'Close after the expected announcement window.',
  },
  {
    id: 'product-priority',
    type: 'Opinion',
    category: 'Product',
    title: 'Product priority',
    question: 'Should Presto prioritize creator tools over analytics next?',
    rules: 'YES means creator tools should be prioritized first. NO means analytics and portfolio depth should be prioritized first.',
    sourceOfTruth: 'Final public roadmap update or governance summary.',
    resolutionMode: 'Community resolver',
    closeHint: 'Close after the feedback window.',
  },
  {
    id: 'governance-sentiment',
    type: 'Opinion',
    category: 'Governance',
    title: 'Governance sentiment',
    question: 'Will this proposal receive majority support?',
    rules: 'YES wins if the proposal receives more support than opposition in the final public vote or signal poll.',
    sourceOfTruth: 'Final vote, forum poll, or signed governance result.',
    resolutionMode: 'Community resolver',
    closeHint: 'Close at the end of the vote.',
  },
  {
    id: 'builder-focus',
    type: 'Opinion',
    category: 'Ecosystem',
    title: 'Builder focus',
    question: 'Should consumer payments be Arc builders top focus this quarter?',
    rules: 'YES wins if consumer payments receives the most verified ecosystem submissions and builder commitments by close.',
    sourceOfTruth: 'Public Arc ecosystem submissions, builder releases, and confirmed launch announcements.',
    resolutionMode: 'Agent assisted',
    closeHint: 'Close at the end of the quarter or campaign.',
  },
  {
    id: 'arc-app-launch',
    type: 'Prediction',
    category: 'Ecosystem',
    title: 'Arc app launch',
    question: 'Will a public Arc app in this category launch before the deadline?',
    rules: 'YES wins if a qualifying public app launches on Arc Testnet before close. NO wins otherwise.',
    sourceOfTruth: 'Public deployment, launch announcement, and verifiable contract or app link.',
    resolutionMode: 'Agent assisted',
    closeHint: 'Close after the expected launch window.',
  },
];

export const marketCategories = Array.from(new Set(marketTemplates.map((template) => template.category)));
