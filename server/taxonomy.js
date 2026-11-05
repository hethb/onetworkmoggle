// A fixed list of industries keeps matching deterministic: "FinTech", "fin-tech"
// and "financial technology" all land on the same value.
export const INDUSTRIES = [
  'Software', 'AI & Data', 'Cybersecurity', 'Hardware & Robotics', 'Fintech',
  'Banking & Finance', 'Venture Capital', 'Consulting', 'Healthcare', 'Biotech & Pharma',
  'Education', 'Marketing & Advertising', 'Sales', 'Media & Entertainment', 'Design',
  'E-commerce & Retail', 'Energy & Climate', 'Manufacturing', 'Real Estate',
  'Legal', 'Government & Nonprofit', 'Transportation & Logistics',
];

// Fields close enough that a conversation is still useful.
const ADJACENT_GROUPS = [
  ['Software', 'AI & Data', 'Cybersecurity', 'Hardware & Robotics', 'Fintech'],
  ['Fintech', 'Banking & Finance', 'Venture Capital'],
  ['Banking & Finance', 'Consulting', 'Venture Capital'],
  ['Healthcare', 'Biotech & Pharma'],
  ['Marketing & Advertising', 'Sales', 'Media & Entertainment', 'Design', 'E-commerce & Retail'],
  ['Design', 'Software'],
  ['Energy & Climate', 'Manufacturing', 'Hardware & Robotics', 'Transportation & Logistics'],
  ['Legal', 'Government & Nonprofit'],
  ['Education', 'Government & Nonprofit'],
];

export function areAdjacent(a, b) {
  return a !== b && ADJACENT_GROUPS.some((group) => group.includes(a) && group.includes(b));
}

// Keyword signals for the no-API-key parser. Matched on word boundaries.
export const INDUSTRY_KEYWORDS = {
  Software: ['software', 'backend', 'frontend', 'full stack', 'full-stack', 'developer', 'saas', 'devops', 'kubernetes', 'typescript', 'javascript', 'react', 'java', 'golang'],
  'AI & Data': ['machine learning', 'deep learning', 'data scientist', 'data science', 'data engineer', 'artificial intelligence', 'llm', 'nlp', 'pytorch', 'tensorflow', 'analytics'],
  Cybersecurity: ['cybersecurity', 'security engineer', 'penetration', 'infosec', 'soc analyst', 'threat'],
  'Hardware & Robotics': ['robotics', 'firmware', 'embedded', 'semiconductor', 'fpga', 'mechanical engineer', 'electrical engineer'],
  Fintech: ['fintech', 'payments', 'stripe', 'plaid', 'robinhood', 'neobank', 'blockchain', 'crypto'],
  'Banking & Finance': ['investment banking', 'investment banker', 'private equity', 'hedge fund', 'equity research', 'financial analyst', 'goldman sachs', 'jpmorgan', 'morgan stanley', 'cfa', 'asset management', 'accounting'],
  'Venture Capital': ['venture capital', 'venture partner', 'portfolio companies', 'seed fund'],
  Consulting: ['consulting', 'consultant', 'mckinsey', 'bain', 'bcg', 'deloitte', 'accenture'],
  Healthcare: ['healthcare', 'hospital', 'clinical', 'nurse', 'physician', 'medical', 'patient'],
  'Biotech & Pharma': ['biotech', 'pharma', 'pharmaceutical', 'genomics', 'drug discovery', 'wet lab'],
  Education: ['teacher', 'teaching', 'curriculum', 'edtech', 'professor', 'k-12'],
  'Marketing & Advertising': ['marketing', 'seo', 'advertising', 'brand manager', 'growth marketing', 'content strategy', 'social media'],
  Sales: ['account executive', 'sales development', 'business development', 'quota', 'crm', 'salesforce'],
  'Media & Entertainment': ['journalist', 'film', 'broadcast', 'publishing', 'podcast', 'entertainment', 'video production'],
  Design: ['product designer', 'ux', 'ui designer', 'graphic design', 'figma', 'user research'],
  'E-commerce & Retail': ['e-commerce', 'ecommerce', 'retail', 'merchandising', 'shopify', 'amazon marketplace'],
  'Energy & Climate': ['renewable', 'solar', 'climate', 'sustainability', 'oil and gas', 'battery'],
  Manufacturing: ['manufacturing', 'supply chain', 'lean six sigma', 'production line', 'plant manager'],
  'Real Estate': ['real estate', 'property management', 'realtor', 'mortgage'],
  Legal: ['attorney', 'paralegal', 'law firm', 'litigation', 'juris doctor', 'corporate counsel'],
  'Government & Nonprofit': ['nonprofit', 'non-profit', 'public policy', 'government', 'ngo', 'city council'],
  'Transportation & Logistics': ['logistics', 'freight', 'fleet', 'aviation', 'shipping'],
};
