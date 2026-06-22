export type CipCode = string;
export type NaicsCode = string;
export type SocCode = string;

export type LicensureRequirement = {
  id: string;
  state: string;
  cipCode: CipCode;
  naicsCode: NaicsCode;
  socCode?: SocCode;
  enforcementType: 'License/Certificate' | 'Registration' | 'Other';
  title: string;
  authority?: string;
  confidence: number;
  riskScore: number;
};

export type LicensureLookupInput = {
  state: string;
  cipCode?: CipCode;
  naicsCode?: NaicsCode;
  socCode?: SocCode;
  title?: string;
  includeInactive?: boolean;
};

export type LicensureLookupResult = {
  input: LicensureLookupInput;
  requirements: readonly LicensureRequirement[];
  matched: boolean;
  confidence: number;
  searchedAt: string;
};
