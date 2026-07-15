import type { RetrievedChunk } from "../retrievalService";

export type EvidenceRef = {
  fileId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
};

export type SkillEvidence = {
  skill: string;
  mentions: number;
  maxScore: number;
  evidence: EvidenceRef[];
};

const SKILL_ALIASES: Record<string, string> = {
  "node.js": "nodejs",
  nodejs: "nodejs",
  node: "nodejs",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  reactjs: "react",
  "react.js": "react",
  react: "react",
  vue: "vue",
  vuejs: "vue",
  angular: "angular",
  svelte: "svelte",
  next: "nextjs",
  nextjs: "nextjs",
  nuxt: "nuxt",
  html: "html",
  html5: "html",
  css: "css",
  css3: "css",
  scss: "sass",
  sass: "sass",
  bootstrap: "bootstrap",
  tailwindcss: "tailwind",
  tailwind: "tailwind",
  redux: "redux",
  "redux toolkit": "redux",
  graphql: "graphql",
  rest: "rest",
  restful: "rest",
  mongodb: "mongodb",
  mongo: "mongodb",
  expressjs: "express",
  express: "express",
  nestjs: "nestjs",
  nest: "nestjs",
  java: "java",
  spring: "spring",
  springboot: "spring_boot",
  "spring boot": "spring_boot",
  kotlin: "kotlin",
  swift: "swift",
  php: "php",
  laravel: "laravel",
  ruby: "ruby",
  rails: "rails",
  "ruby on rails": "rails",
  c: "c",
  "c++": "cpp",
  cplusplus: "cpp",
  "c#": "csharp",
  csharp: "csharp",
  golang: "go",
  go: "go",
  rust: "rust",
  python: "python",
  pandas: "pandas",
  numpy: "numpy",
  scipy: "scipy",
  sklearn: "scikit_learn",
  "scikit-learn": "scikit_learn",
  tensorflow: "tensorflow",
  pytorch: "pytorch",
  keras: "keras",
  huggingface: "huggingface",
  "hugging face": "huggingface",
  langchain: "langchain",
  llamaindex: "llamaindex",
  sql: "sql",
  nosql: "nosql",
  postgresql: "postgresql",
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mariadb: "mariadb",
  oracle: "oracle",
  redis: "redis",
  elasticsearch: "elasticsearch",
  opensearch: "opensearch",
  dynamodb: "dynamodb",
  firestore: "firestore",
  kafka: "kafka",
  rabbitmq: "rabbitmq",
  git: "git",
  github: "github",
  gitlab: "gitlab",
  bitbucket: "bitbucket",
  cicd: "ci_cd",
  "ci/cd": "ci_cd",
  jenkins: "jenkins",
  "github actions": "github_actions",
  dockercompose: "docker_compose",
  "docker compose": "docker_compose",
  docker: "docker",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  terraform: "terraform",
  ansible: "ansible",
  aws: "aws",
  ec2: "aws_ec2",
  s3: "aws_s3",
  lambda: "aws_lambda",
  cloudwatch: "aws_cloudwatch",
  aliyun: "aliyun",
  gcp: "gcp",
  azure: "azure",
  ai: "ai",
  "artificial intelligence": "ai",
  genai: "genai",
  "agentic ai": "agentic_ai",
  "agentic-ai": "agentic_ai",
  rag: "rag",
  "rag-based": "rag",
  ml: "machine_learning",
  "machine learning": "machine_learning",
  "deep learning": "deep_learning",
  r: "r",
  nlp: "nlp",
  "natural language processing": "nlp",
  frontend: "frontend",
  "frontend development": "frontend",
  "statistical modelling": "statistical_modeling",
  "statistical modeling": "statistical_modeling",
  "predictive models": "predictive_modeling",
  "predictive modeling": "predictive_modeling",
  "data visualisation": "data_visualization",
  "data visualization": "data_visualization",
  "power bi": "power_bi",
  tableau: "tableau",
  esg: "esg",
  hkex: "hkex",
  "esg reporting": "esg_reporting",
  "impact measurement": "impact_measurement",
  "social impact": "social_impact",
  vite: "vite",
  webpack: "webpack",
  babel: "babel",
  jest: "jest",
  vitest: "vitest",
  playwright: "playwright",
  cypress: "cypress",
  selenium: "selenium",
  pytest: "pytest",
  junit: "junit",
  qdrant: "qdrant",
  pgvector: "pgvector",
};

const KNOWN_SKILLS = new Set(Object.values(SKILL_ALIASES));
const PHRASE_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\bnode\.?js\b/gi, skill: "nodejs" },
  { pattern: /\btypescript\b|\bts\b/gi, skill: "typescript" },
  { pattern: /\bjavascript\b|\bjs\b/gi, skill: "javascript" },
  { pattern: /\breact(\.js)?\b/gi, skill: "react" },
  { pattern: /\bvue(\.js)?\b/gi, skill: "vue" },
  { pattern: /\bangular\b/gi, skill: "angular" },
  { pattern: /\bsvelte\b/gi, skill: "svelte" },
  { pattern: /\bnext\.?js\b|\bnextjs\b/gi, skill: "nextjs" },
  { pattern: /\bnuxt(\.js)?\b|\bnuxtjs\b/gi, skill: "nuxt" },
  { pattern: /\bhtml5?\b/gi, skill: "html" },
  { pattern: /\bcss3?\b/gi, skill: "css" },
  { pattern: /\b(sass|scss)\b/gi, skill: "sass" },
  { pattern: /\bbootstrap\b/gi, skill: "bootstrap" },
  { pattern: /\btailwind(\s?css)?\b/gi, skill: "tailwind" },
  { pattern: /\bredux(\s+toolkit)?\b/gi, skill: "redux" },
  { pattern: /\bgraphql\b/gi, skill: "graphql" },
  { pattern: /\brest(ful)?\b/gi, skill: "rest" },
  { pattern: /\bnest\.?js\b|\bnestjs\b/gi, skill: "nestjs" },
  { pattern: /\bspring\s*boot\b/gi, skill: "spring_boot" },
  { pattern: /\bspring\b/gi, skill: "spring" },
  { pattern: /\bphp\b/gi, skill: "php" },
  { pattern: /\blaravel\b/gi, skill: "laravel" },
  { pattern: /\bruby on rails\b|\brails\b/gi, skill: "rails" },
  { pattern: /\bruby\b/gi, skill: "ruby" },
  { pattern: /\bc\+\+\b/gi, skill: "cpp" },
  { pattern: /\bc#\b/gi, skill: "csharp" },
  { pattern: /\brust\b/gi, skill: "rust" },
  { pattern: /\bnlp\b|\bnatural language processing\b/gi, skill: "nlp" },
  { pattern: /\bai\b|\bartificial intelligence\b/gi, skill: "ai" },
  { pattern: /\bgenai\b|\bgenerative ai\b/gi, skill: "genai" },
  { pattern: /\bagentic[\s-]?ai\b/gi, skill: "agentic_ai" },
  { pattern: /\brag\b|\bretrieval augmented generation\b|\brag-based\b/gi, skill: "rag" },
  { pattern: /\bml\b|\bmachine learning\b/gi, skill: "machine_learning" },
  { pattern: /\bdeep learning\b/gi, skill: "deep_learning" },
  { pattern: /\bfront[\s-]?end\b|\bfrontend development\b/gi, skill: "frontend" },
  { pattern: /\bpandas\b/gi, skill: "pandas" },
  { pattern: /\bnumpy\b/gi, skill: "numpy" },
  { pattern: /\bscipy\b/gi, skill: "scipy" },
  { pattern: /\bscikit[\s-]?learn\b|\bsklearn\b/gi, skill: "scikit_learn" },
  { pattern: /\btensorflow\b/gi, skill: "tensorflow" },
  { pattern: /\bpytorch\b/gi, skill: "pytorch" },
  { pattern: /\bkeras\b/gi, skill: "keras" },
  { pattern: /\bhugging[\s-]?face\b/gi, skill: "huggingface" },
  { pattern: /\blangchain\b/gi, skill: "langchain" },
  { pattern: /\bllamaindex\b/gi, skill: "llamaindex" },
  { pattern: /\bstatistical modelling\b|\bstatistical modeling\b/gi, skill: "statistical_modeling" },
  { pattern: /\bpredictive models?\b|\bpredictive modeling\b/gi, skill: "predictive_modeling" },
  { pattern: /\bdata visualisation\b|\bdata visualization\b/gi, skill: "data_visualization" },
  { pattern: /\bpower\s*bi\b/gi, skill: "power_bi" },
  { pattern: /\btableau\b/gi, skill: "tableau" },
  { pattern: /\besg\b/gi, skill: "esg" },
  { pattern: /\bhkex\b/gi, skill: "hkex" },
  { pattern: /\besg reporting\b/gi, skill: "esg_reporting" },
  { pattern: /\bimpact measurement\b/gi, skill: "impact_measurement" },
  { pattern: /\bsocial impact\b/gi, skill: "social_impact" },
  { pattern: /\bpython\b/gi, skill: "python" },
  { pattern: /\br\b/gi, skill: "r" },
  { pattern: /\bmongodb\b|\bmongo\b/gi, skill: "mongodb" },
  { pattern: /\bpostgres(ql)?\b/gi, skill: "postgresql" },
  { pattern: /\bmysql\b/gi, skill: "mysql" },
  { pattern: /\bsqlite\b/gi, skill: "sqlite" },
  { pattern: /\bmariadb\b/gi, skill: "mariadb" },
  { pattern: /\boracle\b/gi, skill: "oracle" },
  { pattern: /\bredis\b/gi, skill: "redis" },
  { pattern: /\belasticsearch\b/gi, skill: "elasticsearch" },
  { pattern: /\bopensearch\b/gi, skill: "opensearch" },
  { pattern: /\bdynamodb\b/gi, skill: "dynamodb" },
  { pattern: /\bfirestore\b/gi, skill: "firestore" },
  { pattern: /\bkafka\b/gi, skill: "kafka" },
  { pattern: /\brabbitmq\b/gi, skill: "rabbitmq" },
  { pattern: /\bgit\b/gi, skill: "git" },
  { pattern: /\bgithub\b/gi, skill: "github" },
  { pattern: /\bgitlab\b/gi, skill: "gitlab" },
  { pattern: /\bbitbucket\b/gi, skill: "bitbucket" },
  { pattern: /\bci\/cd\b|\bcicd\b/gi, skill: "ci_cd" },
  { pattern: /\bgithub actions\b/gi, skill: "github_actions" },
  { pattern: /\bjenkins\b/gi, skill: "jenkins" },
  { pattern: /\bdocker compose\b|\bdocker-compose\b/gi, skill: "docker_compose" },
  { pattern: /\bdocker\b/gi, skill: "docker" },
  { pattern: /\bkubernetes\b|\bk8s\b/gi, skill: "kubernetes" },
  { pattern: /\bterraform\b/gi, skill: "terraform" },
  { pattern: /\bansible\b/gi, skill: "ansible" },
  { pattern: /\baws\b/gi, skill: "aws" },
  { pattern: /\bec2\b/gi, skill: "aws_ec2" },
  { pattern: /\bs3\b/gi, skill: "aws_s3" },
  { pattern: /\blambda\b/gi, skill: "aws_lambda" },
  { pattern: /\bcloudwatch\b/gi, skill: "aws_cloudwatch" },
  { pattern: /\bgcp\b/gi, skill: "gcp" },
  { pattern: /\bazure\b/gi, skill: "azure" },
  { pattern: /\bvite\b/gi, skill: "vite" },
  { pattern: /\bwebpack\b/gi, skill: "webpack" },
  { pattern: /\bbabel\b/gi, skill: "babel" },
  { pattern: /\bjest\b/gi, skill: "jest" },
  { pattern: /\bvitest\b/gi, skill: "vitest" },
  { pattern: /\bplaywright\b/gi, skill: "playwright" },
  { pattern: /\bcypress\b/gi, skill: "cypress" },
  { pattern: /\bselenium\b/gi, skill: "selenium" },
  { pattern: /\bpytest\b/gi, skill: "pytest" },
  { pattern: /\bjunit\b/gi, skill: "junit" },
];
const JD_REQUIRED_CUES = [
  "must",
  "required",
  "requirements",
  "qualifications",
  "need",
  "should have",
  "proficient",
];
const JD_SECTION_HEADERS = ["requirements", "qualifications", "must have", "skills required"];
const PREFERRED_CUES = ["preferred", "preferably", "familiar with", "familiarity with", "nice to have"];
const NICE_TO_HAVE_CUES = ["is a plus", "a plus", "bonus", "advantage"];
const RESPONSIBILITY_SECTION_HEADERS = ["responsibilities", "what you will do", "what you'll do"];

export type DeterministicRequirementSkill = {
  name: string;
  canonicalName: string;
  priority: "must_have" | "preferred" | "nice_to_have" | "responsibility";
  evidence: string;
  confidence: number;
};

export type DeterministicRequirementGroups = {
  requiredSkills: DeterministicRequirementSkill[];
  preferredSkills: DeterministicRequirementSkill[];
  niceToHaveSkills: DeterministicRequirementSkill[];
  responsibilitySkills: DeterministicRequirementSkill[];
  experienceRequirements: [];
};

const normalizeToken = (token: string): string => {
  const cleaned = token.toLowerCase().replace(/[^a-z0-9.+#]/g, "");
  if (!cleaned) {
    return "";
  }
  return SKILL_ALIASES[cleaned] ?? cleaned;
};

const toEvidenceRef = (chunk: RetrievedChunk): EvidenceRef => ({
  fileId: chunk.fileId,
  fileName: chunk.fileName,
  chunkId: chunk.chunkId,
  chunkIndex: chunk.chunkIndex,
  score: chunk.score,
});

const extractSkillsFromText = (text: string): string[] => {
  const phraseSkills = new Set<string>();
  for (const item of PHRASE_PATTERNS) {
    if (item.pattern.test(text)) {
      phraseSkills.add(item.skill);
    }
    item.pattern.lastIndex = 0;
  }

  const tokens = text
    .split(/[\s,;:|/()\[\]{}]+/)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
  const tokenSkills = tokens.filter((token) => KNOWN_SKILLS.has(token));
  return [...new Set([...phraseSkills, ...tokenSkills])];
};

export const extractSkillEvidence = (chunks: RetrievedChunk[]): Map<string, SkillEvidence> => {
  const map = new Map<string, SkillEvidence>();

  for (const chunk of chunks) {
    const skillSet = new Set(extractSkillsFromText(chunk.textPreview));
    for (const skill of skillSet) {
      const existing = map.get(skill);
      if (!existing) {
        map.set(skill, {
          skill,
          mentions: 1,
          maxScore: chunk.score,
          evidence: [toEvidenceRef(chunk)],
        });
      } else {
        existing.mentions += 1;
        existing.maxScore = Math.max(existing.maxScore, chunk.score);
        if (!existing.evidence.some((item) => item.chunkId === chunk.chunkId)) {
          existing.evidence.push(toEvidenceRef(chunk));
        }
      }
    }
  }

  return map;
};

export const extractRequiredSkillsFromJd = (chunks: RetrievedChunk[]): Set<string> => {
  const required = new Set<string>();
  const fallback = new Set<string>();
  let inRequirementsSection = false;

  for (const chunk of chunks) {
    const lines = chunk.textPreview
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const skills = extractSkillsFromText(line);
      skills.forEach((skill) => fallback.add(skill));
      const normalizedLine = line.toLowerCase();
      const isHeader = JD_SECTION_HEADERS.some((header) => normalizedLine.includes(header));
      if (isHeader) {
        inRequirementsSection = true;
      }

      if (JD_REQUIRED_CUES.some((cue) => normalizedLine.includes(cue)) || inRequirementsSection) {
        skills.forEach((skill) => required.add(skill));
      }

      if (
        normalizedLine.includes("responsibilities") ||
        normalizedLine.includes("job description") ||
        normalizedLine.includes("about the role")
      ) {
        inRequirementsSection = false;
      }
    }
  }

  return required.size > 0 ? required : fallback;
};

export const extractDeterministicRequirementGroups = (
  text: string,
): DeterministicRequirementGroups => {
  const grouped = {
    requiredSkills: [] as DeterministicRequirementSkill[],
    preferredSkills: [] as DeterministicRequirementSkill[],
    niceToHaveSkills: [] as DeterministicRequirementSkill[],
    responsibilitySkills: [] as DeterministicRequirementSkill[],
    experienceRequirements: [] as [],
  };
  const seen = new Set<string>();
  let inRequirementsSection = false;
  let inResponsibilitiesSection = false;

  for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const normalizedLine = line.toLowerCase();
    const isSectionHeader = JD_SECTION_HEADERS.some(
      (header) => normalizedLine === header || normalizedLine === `${header}:`,
    );
    if (isSectionHeader) {
      inRequirementsSection = true;
      inResponsibilitiesSection = false;
      continue;
    }
    if (RESPONSIBILITY_SECTION_HEADERS.some((header) => normalizedLine.includes(header))) {
      inRequirementsSection = false;
      inResponsibilitiesSection = true;
      continue;
    }

    const priority = NICE_TO_HAVE_CUES.some((cue) => normalizedLine.includes(cue))
      ? "nice_to_have"
      : PREFERRED_CUES.some((cue) => normalizedLine.includes(cue))
        ? "preferred"
        : inResponsibilitiesSection
          ? "responsibility"
          : inRequirementsSection || JD_REQUIRED_CUES.some((cue) => normalizedLine.includes(cue))
            ? "must_have"
            : null;
    if (!priority) continue;

    for (const skill of extractSkillsFromText(line)) {
      const key = `${priority}:${skill}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item: DeterministicRequirementSkill = {
        name: skill,
        canonicalName: skill,
        priority,
        evidence: line,
        confidence: 1,
      };
      if (priority === "must_have") grouped.requiredSkills.push(item);
      if (priority === "preferred") grouped.preferredSkills.push(item);
      if (priority === "nice_to_have") grouped.niceToHaveSkills.push(item);
      if (priority === "responsibility") grouped.responsibilitySkills.push(item);
    }
  }

  return grouped;
};
