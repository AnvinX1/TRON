/**
 * TRON — Pattern Engine v2
 * Extracts questions, topics, and patterns from exam document text.
 * Tuned for university question paper formats (Part A/B/C, marks, modules, CO tags, etc.)
 *
 * FIXES in v2:
 *  - Question text is capped to prevent runaway concatenation
 *  - Continuation lines are limited to avoid swallowing entire documents
 *  - Topic matching uses word-boundary checks to prevent false positives (e.g. "osi" inside "curiosity")
 *  - Predictions show clean, individual questions instead of text dumps
 *  - Deduplication uses longer keys for better accuracy
 */

// ─── Question Extraction ─────────────────────────────────────

// Patterns indicating question text (imperative/interrogative)
const QUESTION_KEYWORDS = [
  'explain', 'describe', 'define', 'discuss', 'compare', 'differentiate',
  'list', 'enumerate', 'state', 'prove', 'derive', 'solve', 'calculate',
  'find', 'evaluate', 'analyze', 'analyse', 'illustrate', 'draw', 'sketch',
  'write', 'what', 'why', 'how', 'when', 'which', 'distinguish',
  'mention', 'brief', 'elaborate', 'determine', 'compute', 'obtain',
  'show', 'verify', 'classify', 'construct', 'design', 'implement',
  'demonstrate', 'convert', 'apply', 'interpret',
];

// Marks extraction: "(5)", "[5]", "(5 marks)", "[5M]", etc.
const MARKS_PATTERN = /\[?\(?\s*(\d{1,2})\s*(?:marks?|m|M|pts?|points?)\s*\)?\]?/gi;
// Standalone marks in parentheses at end of line: (7), (8), (15)
const TRAILING_MARKS = /\(\s*(\d{1,2})\s*\)\s*$/;

// Part/Section extraction
const PART_PATTERN = /(?:PART|SECTION)\s*[-–:]?\s*([A-C])/i;
const MODULE_PATTERN = /(?:MODULE|UNIT|CHAPTER)\s*[-–:]?\s*(\d{1,2}|[IVX]{1,5})/i;

// Lines to skip entirely
const SKIP_PATTERNS = [
  /^(reg\.?\s*no|register|hall\s*ticket|time\s*:|date\s*:|max\.?\s*marks|semester|sub\w*\s*code)/i,
  /^(answer\s*(all|any)|note\s*:|instructions)/i,
  /^(course\s*code|course\s*title|branch|year|exam\s*type)/i,
  /^\s*\*{3,}\s*$/,   // "****" separators
  /^(PART|SECTION)\s/i,
  /^(CO\d)\s*$/i,      // standalone CO tags
  /^\s*OR\s*$/i,
];

// CO tag pattern: "CO1", "CO2 i)", "CO3 ii)" at start of line
const CO_TAG = /^(CO\d+)\s*/i;

// Max length for a single question text (prevents runaway)
const MAX_QUESTION_LENGTH = 400;
// Max continuation lines to append
const MAX_CONTINUATION_LINES = 4;

/**
 * Clean and normalize extracted text
 */
function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\t+/g, ' ')
    .replace(/[ ]{3,}/g, '  ')
    .trim();
}

/**
 * Strip marks notation from text
 */
function stripMarks(text) {
  return text
    .replace(MARKS_PATTERN, '')
    .replace(TRAILING_MARKS, '')
    .trim();
}

/**
 * Extract marks value from a line
 */
function extractMarks(line) {
  // Try trailing parenthesized number first: "... (7)"
  const trailingMatch = line.match(TRAILING_MARKS);
  if (trailingMatch) return parseInt(trailingMatch[1]);

  // Try explicit marks pattern
  const marksRe = /\[?\(?\s*(\d{1,2})\s*(?:marks?|m|M)\s*\)?\]?/i;
  const m = line.match(marksRe);
  if (m) return parseInt(m[1]);

  return null;
}

/**
 * Check if a line is a "new question" boundary
 */
function isQuestionStart(line) {
  // Numbered: "1.", "1)", "Q1.", "Q.1", "1 -", with optional CO tag prefix
  return /^\s*(?:CO\d+\s+)?(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–]\s*(.+)/i.test(line);
}

/**
 * Check if a line is a sub-question boundary: "(a)", "a)", "i)", "(ii)"
 */
function isSubQuestionStart(line) {
  return /^\s*(?:CO\d+\s+)?\(?([a-z]|[ivx]{1,4})\)\s*(.+)/i.test(line);
}

/**
 * Should this line be skipped?
 */
function shouldSkip(line) {
  return SKIP_PATTERNS.some(p => p.test(line));
}

/**
 * Extract questions from document text
 */
export function extractQuestions(text, sourceFileName) {
  const normalized = normalizeText(text);
  const questions = [];
  const seen = new Set();

  const lines = normalized.split('\n');
  let currentQuestion = null;
  let continuationCount = 0;
  let currentPart = '';
  let currentModule = '';

  function pushCurrent() {
    if (currentQuestion && currentQuestion.text.length > 15) {
      // Clean up text
      currentQuestion.text = stripMarks(currentQuestion.text).replace(/\s+/g, ' ').trim();
      // Cap length
      if (currentQuestion.text.length > MAX_QUESTION_LENGTH) {
        currentQuestion.text = currentQuestion.text.substring(0, MAX_QUESTION_LENGTH) + '…';
      }
      questions.push(currentQuestion);
    }
    currentQuestion = null;
    continuationCount = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (shouldSkip(line)) continue;

    // Detect part/section headers
    const partMatch = line.match(PART_PATTERN);
    if (partMatch && line.length < 30) {
      pushCurrent();
      currentPart = `Part ${partMatch[1].toUpperCase()}`;
      continue;
    }

    const moduleMatch = line.match(MODULE_PATTERN);
    if (moduleMatch && line.length < 40) {
      pushCurrent();
      currentModule = `Module ${moduleMatch[1]}`;
      continue;
    }

    // Strip CO tag from line for processing
    let processLine = line;
    let coTag = '';
    const coMatch = line.match(CO_TAG);
    if (coMatch) {
      coTag = coMatch[1];
      processLine = line.substring(coMatch[0].length).trim();
    }

    // ── Check for numbered question start ──
    const qMatch = processLine.match(/^(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–]\s*(.+)/i);
    if (qMatch) {
      pushCurrent();
      const marks = extractMarks(processLine);
      currentQuestion = {
        id: `q-${questions.length + 1}`,
        number: qMatch[1],
        text: stripMarks(qMatch[2]).trim(),
        marks,
        part: currentPart,
        module: currentModule,
        coTag,
        source: sourceFileName,
        lineRef: i + 1,
      };
      continuationCount = 0;
      continue;
    }

    // ── Check for sub-question start: (a), (i), etc. ──
    const subMatch = processLine.match(/^\(?([a-z]|[ivx]{1,4})\)\s*(.+)/i);
    if (subMatch) {
      pushCurrent();
      const marks = extractMarks(processLine);
      currentQuestion = {
        id: `q-${questions.length + 1}`,
        number: subMatch[1],
        text: stripMarks(subMatch[2]).trim(),
        marks,
        part: currentPart,
        module: currentModule,
        coTag,
        source: sourceFileName,
        lineRef: i + 1,
      };
      continuationCount = 0;
      continue;
    }

    // ── Continuation of current question (limited) ──
    if (currentQuestion && continuationCount < MAX_CONTINUATION_LINES && processLine.length > 3) {
      // Don't continue if this line looks like a header or noise
      if (processLine.length < 80) {
        currentQuestion.text += ' ' + stripMarks(processLine);
        continuationCount++;
      }
    }
  }

  // Push the last question
  pushCurrent();

  // Filter: keep only lines that look like actual questions
  return questions.filter(q => {
    const lower = q.text.toLowerCase();
    const hasKeyword = QUESTION_KEYWORDS.some(kw => {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      return re.test(lower);
    });
    const hasQuestionMark = q.text.includes('?');
    const isLongEnough = q.text.length > 20;
    const key = q.text.substring(0, 100).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return (hasKeyword || hasQuestionMark) && isLongEnough;
  });
}

// ─── Topic Extraction ─────────────────────────────────────────

// Topic keywords — using word-boundary matching to prevent false positives
// Key format: [keyword, topicLabel, requireWordBoundary]
const TOPIC_ENTRIES = [
  // COA
  ['pipeline', 'Pipelining', true],
  ['pipelining', 'Pipelining', true],
  ['cache memory', 'Cache Memory', false],
  ['cache', 'Cache Memory', true],
  ['virtual memory', 'Virtual Memory', false],
  ['instruction set', 'Instruction Set', false],
  ['addressing mode', 'Addressing Modes', false],
  ['risc', 'RISC vs CISC', true],
  ['cisc', 'RISC vs CISC', true],
  ['microprogramming', 'Microprogramming', true],
  ['control unit', 'Control Unit', false],
  ['dma', 'DMA', true],
  ['interrupt', 'Interrupts', true],
  // Math — Transforms
  ['laplace transform', 'Laplace Transform', false],
  ['laplace', 'Laplace Transform', true],
  ['fourier transform', 'Fourier Transform', false],
  ['fourier series', 'Fourier Series', false],
  ['fourier cosine', 'Fourier Cosine Transform', false],
  ['fourier sine', 'Fourier Sine Transform', false],
  ['z-transform', 'Z-Transform', false],
  ['z transform', 'Z-Transform', false],
  ['inverse z', 'Inverse Z-Transform', false],
  ['convolution theorem', 'Convolution Theorem', false],
  ['convolution', 'Convolution', true],
  ['residue', 'Residues', true],
  ['partial fraction', 'Partial Fractions', false],
  // Math — Linear Algebra
  ['eigenvalue', 'Eigenvalues', true],
  ['eigenvector', 'Eigenvectors', true],
  ['eigen', 'Eigenvalues/Eigenvectors', true],
  ['matrix', 'Matrix Operations', true],
  ['rank of matrix', 'Rank of Matrix', false],
  ['determinant', 'Determinants', true],
  ['linear algebra', 'Linear Algebra', false],
  // Math — Calculus
  ['differential equation', 'Differential Equations', false],
  ['differential calculus', 'Differential Calculus', false],
  ['partial derivative', 'Partial Derivatives', false],
  ['integration', 'Integration', true],
  ['taylor', 'Taylor Series', true],
  ['maxima and minima', 'Maxima & Minima', false],
  // Math — ODE
  ['cauchy-euler', 'Cauchy-Euler Equation', false],
  ['legendre', 'Legendre Equation', true],
  ['simultaneous equation', 'Simultaneous Equations', false],
  // Programming / DS
  ['linked list', 'Linked Lists', false],
  ['binary tree', 'Binary Trees', false],
  ['binary search tree', 'Binary Search Trees', false],
  ['dynamic programming', 'Dynamic Programming', false],
  ['sorting algorithm', 'Sorting Algorithms', false],
  ['greedy algorithm', 'Greedy Algorithms', false],
  ['backtracking', 'Backtracking', true],
  ['recursion', 'Recursion', true],
  ['hashing', 'Hashing', true],
  ['time complexity', 'Time Complexity', false],
  ['big o', 'Big O Notation', false],
  ['stack', 'Stacks', true],
  ['queue', 'Queues', true],
  ['graph', 'Graphs', true],
  ['tree', 'Trees', true],
  ['array', 'Arrays', true],
  // MERN
  ['react', 'React', true],
  ['node.js', 'Node.js', false],
  ['nodejs', 'Node.js', true],
  ['express', 'Express.js', true],
  ['mongodb', 'MongoDB', true],
  ['rest api', 'REST API', false],
  ['middleware', 'Middleware', true],
  ['component', 'Components', true],
  // Networking / IoT
  ['tcp/ip', 'TCP/IP', false],
  ['osi model', 'OSI Model', false],
  ['mqtt', 'MQTT', true],
  ['raspberry pi', 'Raspberry Pi', false],
  ['arduino', 'Arduino', true],
  ['sensor', 'Sensors', true],
  // Big Data / HPC
  ['hadoop', 'Hadoop', true],
  ['mapreduce', 'MapReduce', true],
  ['apache spark', 'Apache Spark', false],
  ['parallel computing', 'Parallel Computing', false],
  ['nosql', 'NoSQL', true],
  ['data mining', 'Data Mining', false],
  // Blockchain
  ['blockchain', 'Blockchain', true],
  ['smart contract', 'Smart Contracts', false],
  ['consensus mechanism', 'Consensus Mechanisms', false],
  ['merkle tree', 'Merkle Tree', false],
  // Digital Forensics
  ['digital forensics', 'Digital Forensics', false],
  ['malware', 'Malware Analysis', true],
  ['incident response', 'Incident Response', false],
  ['encryption', 'Encryption', true],
  ['cryptography', 'Cryptography', true],
  // Software Testing
  ['black box testing', 'Black Box Testing', false],
  ['white box testing', 'White Box Testing', false],
  ['regression testing', 'Regression Testing', false],
  ['unit testing', 'Unit Testing', false],
  ['integration testing', 'Integration Testing', false],
  ['boundary value', 'Boundary Value Analysis', false],
  ['equivalence partitioning', 'Equivalence Partitioning', false],
  ['test case', 'Test Cases', false],
  ['software testing', 'Software Testing', false],
  // EEE
  ['kirchhoff', 'Kirchhoff\'s Laws', true],
  ['thevenin', 'Thevenin\'s Theorem', true],
  ['norton', 'Norton\'s Theorem', true],
  ['transformer', 'Transformers', true],
  ['induction motor', 'Induction Motor', false],
  ['dc motor', 'DC Motor', false],
];

/**
 * Extract topics from text using word-boundary-aware matching
 */
export function extractTopics(text) {
  const lower = text.toLowerCase();
  const found = new Map();

  for (const [keyword, topic, useWordBoundary] of TOPIC_ENTRIES) {
    let matched = false;
    if (useWordBoundary) {
      // Use regex word boundary to avoid false positives
      const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      matched = re.test(lower);
    } else {
      matched = lower.includes(keyword.toLowerCase());
    }

    if (matched) {
      found.set(topic, (found.get(topic) || 0) + 1);
    }
  }

  return Array.from(found.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Classify question type
 */
export function classifyQuestion(text) {
  const lower = text.toLowerCase();
  if (/\b(prove|derive|show\s+that|verify)\b/.test(lower)) return 'Proof/Derivation';
  if (/\b(solve|calculate|compute|find|evaluate|determine|obtain)\b/.test(lower)) return 'Numerical/Problem';
  if (/\b(explain|describe|discuss|elaborate|illustrate)\b/.test(lower)) return 'Descriptive';
  if (/\b(define|state|list|enumerate|mention|write\s+short)\b/.test(lower)) return 'Short Answer';
  if (/\b(compare|differentiate|distinguish|contrast)\b/.test(lower)) return 'Comparative';
  if (/\b(draw|sketch|diagram)\b/.test(lower)) return 'Diagram-based';
  if (/\b(design|implement|construct|write\s+a?\s*(program|code|algorithm))\b/.test(lower)) return 'Implementation';
  if (/\b(apply|demonstrate)\b/.test(lower)) return 'Application';
  return 'General';
}

/**
 * Estimate difficulty based on marks and question keywords
 */
export function estimateDifficulty(question) {
  const marks = question.marks || 0;
  const text = question.text.toLowerCase();

  let score = 0;
  if (marks >= 10) score += 3;
  else if (marks >= 5) score += 2;
  else if (marks >= 2) score += 1;

  if (/\b(prove|derive|design|implement|analyze)\b/.test(text)) score += 2;
  if (/\b(explain|describe|discuss)\b/.test(text)) score += 1;
  if (/\b(define|list|state|mention)\b/.test(text)) score -= 1;

  if (score >= 4) return 'Hard';
  if (score >= 2) return 'Medium';
  return 'Easy';
}

// ─── Cross-Document Pattern Analysis ──────────────────────────

/**
 * Analyze patterns across multiple documents
 */
export function analyzePatterns(documents) {
  const topicFrequency = new Map();   // topic -> { count, docs: Set }
  const questionTypes = new Map();     // type -> count
  const difficultyDist = { Easy: 0, Medium: 0, Hard: 0 };
  const topicCooccurrence = new Map(); // "topicA|topicB" -> count
  const questionBank = [];             // all questions across docs

  for (const doc of documents) {
    const docTopics = new Set();

    for (const q of doc.questions) {
      questionBank.push(q);

      // Question type
      const qType = classifyQuestion(q.text);
      questionTypes.set(qType, (questionTypes.get(qType) || 0) + 1);

      // Difficulty
      const diff = estimateDifficulty(q);
      difficultyDist[diff]++;

      // Topics from this question
      const topics = extractTopics(q.text);
      for (const t of topics) {
        docTopics.add(t.topic);
        if (!topicFrequency.has(t.topic)) {
          topicFrequency.set(t.topic, { count: 0, docs: new Set() });
        }
        const entry = topicFrequency.get(t.topic);
        entry.count += t.count;
        entry.docs.add(doc.fileName);
      }
    }

    // Co-occurrence within same document
    const topicArr = Array.from(docTopics);
    for (let i = 0; i < topicArr.length; i++) {
      for (let j = i + 1; j < topicArr.length; j++) {
        const key = [topicArr[i], topicArr[j]].sort().join('|');
        topicCooccurrence.set(key, (topicCooccurrence.get(key) || 0) + 1);
      }
    }
  }

  // Convert maps to sorted arrays
  const topicFreqArr = Array.from(topicFrequency.entries())
    .map(([topic, data]) => ({
      topic,
      totalCount: data.count,
      documentCount: data.docs.size,
      documents: Array.from(data.docs),
    }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 30);

  const qTypeArr = Array.from(questionTypes.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const cooccurrenceArr = Array.from(topicCooccurrence.entries())
    .map(([key, count]) => {
      const [a, b] = key.split('|');
      return { topicA: a, topicB: b, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    topicFrequency: topicFreqArr,
    questionTypes: qTypeArr,
    difficultyDistribution: difficultyDist,
    topicCooccurrence: cooccurrenceArr,
    totalQuestions: questionBank.length,
    questionBank,
  };
}

// ─── Prediction Engine ────────────────────────────────────────

/**
 * Generate predicted questions based on pattern analysis
 */
export function generatePredictions(patterns, documents) {
  const predictions = [];
  const seenQuestionTexts = new Set();

  for (const topic of patterns.topicFrequency.slice(0, 20)) {
    // Find questions related to this topic — match topic words
    const topicWords = topic.topic.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const relatedQuestions = patterns.questionBank.filter(q => {
      const lower = q.text.toLowerCase();
      return topicWords.some(w => {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        return re.test(lower);
      });
    });

    if (relatedQuestions.length === 0) continue;

    // Deduplicate & pick best representatives
    const uniqueQuestions = deduplicateQuestions(relatedQuestions);

    for (const q of uniqueQuestions.slice(0, 2)) {
      // Skip if we already have a very similar prediction
      const normKey = q.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').substring(0, 120);
      if (seenQuestionTexts.has(normKey)) continue;

      // Check similarity against all existing predictions
      let tooSimilar = false;
      for (const existing of seenQuestionTexts) {
        if (similarity(normKey, existing) > 0.6) {
          tooSimilar = true;
          break;
        }
      }
      if (tooSimilar) continue;
      seenQuestionTexts.add(normKey);

      // Calculate probability
      const docRatio = topic.documentCount / documents.length;
      const freqRatio = Math.min(topic.totalCount / Math.max(patterns.totalQuestions, 1), 1);
      const probability = Math.min(
        95,
        Math.round(docRatio * 55 + freqRatio * 25 + (relatedQuestions.length > 3 ? 10 : 5))
      );

      // Build citations — only from docs that actually contain related questions
      const citationMap = new Map();
      for (const rq of relatedQuestions) {
        if (!citationMap.has(rq.source)) {
          citationMap.set(rq.source, { document: rq.source, questionNum: rq.number, part: rq.part, lineRef: rq.lineRef });
        }
      }

      predictions.push({
        question: q.text,
        topic: topic.topic,
        probability,
        type: classifyQuestion(q.text),
        difficulty: estimateDifficulty(q),
        citations: Array.from(citationMap.values()).slice(0, 5),
        reasoning: `Appeared in ${topic.documentCount}/${documents.length} documents (${topic.totalCount} mentions)`,
      });
    }
  }

  // Sort by probability
  predictions.sort((a, b) => b.probability - a.probability);

  // Assign ranks
  return predictions.slice(0, 40).map((p, i) => ({
    ...p,
    rank: i + 1,
    priorityLevel: p.probability >= 75 ? 'high' : p.probability >= 45 ? 'medium' : 'low',
  }));
}

/**
 * Deduplicate similar questions using Jaccard similarity
 */
function deduplicateQuestions(questions) {
  const unique = [];
  const seenKeys = [];

  for (const q of questions) {
    const key = q.text.toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Skip very short or empty
    if (key.length < 15) continue;

    let isDuplicate = false;
    for (const s of seenKeys) {
      if (similarity(key, s) > 0.55) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seenKeys.push(key);
      unique.push(q);
    }
  }

  return unique;
}

/**
 * Jaccard similarity between two strings (word-level)
 */
function similarity(a, b) {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}
