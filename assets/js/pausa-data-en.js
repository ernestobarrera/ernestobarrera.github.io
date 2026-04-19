/* ═══════════════════════════════════════════════════
   PAUSA — IA Clínica Reflexiva · English content layer
   Translated clinical content for ES → EN i18n
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════
   Translation notes:
   - Cognitive bias terminology: Kahneman / Croskerry / Parasuraman standard EN
   - Regulatory terms: GDPR, AI Act, MDR official EN text (EUR-Lex)
   - Study paraphrases: verified against published abstracts
   - 'intended purpose', 'deployer', 'EUDAMED': untranslated (EU technical terms)
   ═══════════════════════════════════════════════════ */

const CRIT_EN = {
  s1: [
    {
      id: 'y1', icon: '🎯', cat: 'Prior formulation', risk: 'crit',
      q: 'Did you formulate your own diagnostic hypothesis before consulting the AI?',
      why: [
        '<strong>Anchoring bias</strong> acts within milliseconds: reading the AI\'s response first permanently contaminates your reasoning. The brain adjusts its evaluation to the first stimulus received, not the most correct one.',
        'Buçinca et al. (ACM HCI, 2021) showed that interfaces that force deliberate evaluation <em>before</em> showing the suggestion significantly reduce overreliance. Well-used AI does not replace System 2 thinking — <strong>it summons it</strong>.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Progressive atrophy of autonomous diagnostic reasoning through systematic anchoring</div>'
      ],
      how: [
        'Write your clinical impression in 1–2 lines before opening the AI tool',
        'List 2–3 of your own differential diagnoses',
        'Only then formulate your query to the AI',
        'When you receive the suggestion: <em>"What alternatives has it ruled out, and why?"</em>'
      ],
      refs: [
        { txt: 'Buçinca Z, et al. To trust or to think: cognitive forcing functions can reduce overreliance on AI. ACM CSCW. 2021.', url: 'https://doi.org/10.1145/3449287' },
        { txt: 'Croskerry P. Cognitive forcing strategies in clinical decision making. Ann Emerg Med. 2003;41(1):110-120.', url: 'https://pubmed.ncbi.nlm.nih.gov/12514691/' }
      ]
    },
    {
      id: 'y2', icon: '🧩', cat: 'Differential diagnosis', risk: 'high',
      q: 'Did you ask the AI which diagnoses it ruled out, and why?',
      why: [
        'AI tends to offer the <strong>"most probable"</strong> answer without weighing individual clinical context. If it coincides with your first impression, it reinforces a possible error without your awareness.',
        'Rosbach et al. (CHI, 2025) documented that AI <strong>amplified confirmation bias</strong> in pathologists under time pressure. Passively supervising is almost as dangerous as not supervising at all.',
        '<div class="risk-banner rb-high">⚠️ High risk: Premature differential closure — the algorithm does not flag what it does not consider</div>'
      ],
      how: [
        'Explicitly request alternatives to the diagnosis the AI suggests',
        'Ask: "What serious diagnoses might you be missing?"',
        'Use self-consistency: same question with 3 variations → compare convergence',
        'High divergence in responses = signal of genuine uncertainty in the model'
      ],
      refs: [
        { txt: 'Rosbach M, et al. AI amplifies confirmation bias in pathology under time pressure. CHI. 2025.', url: 'https://doi.org/10.1145/3706598.3713319' },
        { txt: 'Saposnik G, et al. Cognitive biases associated with medical decisions. BMC Med Inform. 2016;16:138.', url: 'https://doi.org/10.1186/s12911-016-0377-1' }
      ]
    },
    {
      id: 'y3', icon: '👤', cat: 'Unencoded context', risk: 'high',
      q: 'Have you considered patient factors that the AI cannot know?',
      why: [
        'The AI has the record. It does not have the patient. It does not know their facial expression, undocumented history, fears, family context, or values.',
        'Current benchmarks show that LLMs perform better when the case is well structured and critical information is already available; when the task requires deciding what to explore, requesting further data, or planning treatment, performance drops. In real clinical practice, there are also relational and contextual dimensions the model does not see unless you provide them.',
        '<div class="risk-banner rb-high">⚠️ High risk: Depersonalised medicine — the more complex the patient, the wider the gap</div>'
      ],
      how: [
        '<strong>Classify the task first:</strong> is it pattern-based (AI more useful) or contextual (AI more limited)?',
        'Are there relevant psychosocial, cultural, or relational factors in this case?',
        'What does this patient or family prefer, and what do they fear?',
        'Practical rule: the more it resembles a complex narrative, the less reliable the AI'
      ],
      refs: [
        { txt: 'Qiu P, et al. Quantifying the reasoning abilities of LLMs on clinical cases. Nat Commun. 2025;16:9799.', url: 'https://doi.org/10.1038/s41467-025-64769-1' },
        { txt: 'Greenhalgh T. What matters to patients? BMJ. 2015;350:h1258.', url: 'https://doi.org/10.1136/bmj.h1258' }
      ]
    },
    {
      id: 'y4', icon: '⚖️', cat: 'Calibrated uncertainty', risk: 'crit',
      q: 'Do you recognise that AI sounds assertive even when it does not know that it does not know?',
      why: [
        'An LLM never spontaneously says "I don\'t know." It delivers responses with the same confident tone when it is correct and when it hallucinates. Our brain has an evolutionary shortcut: <em>if something sounds confident, we assume it knows.</em> With humans, this works. With AI, it fails.',
        'Furthermore, LLMs are not fully <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;no_determinismo&#39;)">deterministic</button>: two very similar formulations can return different nuances. If the output varies widely, do not use it as a tiebreaker; treat it as a signal of uncertainty.',
        'Sakamoto et al. (JMIR Formative Research, 2024): correct confidence calibration independently predicts diagnostic accuracy <strong>(adjusted OR: 5.90; 95% CI: 2.93–12.46)</strong>. The useful lesson here is not that AI sounds convincing, but that your calibration matters clinically.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Confusing eloquence with knowledge — LLM confidence does not reflect its accuracy</div>'
      ],
      how: [
        'Do not ask "Are you sure?" Ask: <strong>"What information are you missing to answer better?"</strong>',
        'Ask: "What factors would make this recommendation incorrect?"',
        'With AI-generated documentation: actively review <em>what is missing</em>, not just what it says',
        'If you repeat the query with minimal changes and the output varies widely, treat this as a reason to pause and verify',
        'Document your own confidence level: certain / uncertain / need to consult'
      ],
      refs: [
        { txt: 'Sakamoto T, et al. Facilitating trust calibration in artificial intelligence-driven diagnostic decision support systems for determining physicians\' diagnostic accuracy: quasi-experimental study. JMIR Form Res. 2024;8:e58666.', url: 'https://doi.org/10.2196/58666' },
        { txt: 'Goddard K, et al. Automation bias: a systematic review. JAMIA. 2012;19(1):121-127.', url: 'https://doi.org/10.1136/amiajnl-2011-000089' }
      ]
    },
    {
      id: 'y5', icon: '📄', cat: 'Source verification', risk: 'high',
      q: 'Do you verify the references the AI provides before acting on them?',
      why: [
        'LLMs can <strong>fabricate complete references</strong> — articles, DOIs, authors — with the same confidence as real information. Hallucinations are not exceptions: they are emergent properties of the model.',
        'Tools with RAG or <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;fundamentacion&#39;)">verifiable grounding</button> attempt to respond based on identifiable documents rather than from statistical memory alone. This may reduce the margin of fabrication, but it does not eliminate the need to verify that the source exists, is correctly cited, and actually states what is attributed to it.',
        '<div class="risk-banner rb-high">⚠️ High risk: Clinical decisions based on fabricated or misinterpreted evidence</div>'
      ],
      how: [
        'Prioritise tools that link to verifiable documents and allow you to review original sources',
        'Verify in PubMed every reference before citing it or acting on it',
        'Check that the DOI links to the correct article and that the abstract states what the AI claims',
        'Be sceptical of citations that fit "too perfectly" with your question'
      ],
      refs: [
        { txt: 'Ji Z, et al. Survey of hallucination in natural language generation. ACM Comput Surv. 2023;55(12):1-38.', url: 'https://doi.org/10.1145/3571730' }
      ]
    },
    {
      id: 'y6', icon: '🔄', cat: 'Active anti-deskilling', risk: 'crit',
      q: 'Do you maintain deliberate clinical practice without AI support?',
      why: [
        'Budzyń et al. (Lancet Gastroenterol Hepatol, 2025): endoscopists exposed to AI for just <strong>three months performed significantly worse after it was removed</strong> (ADR: 28.4% → 22.4%; −6.0%; p=0.009). The "Google Maps effect": skills you do not practise atrophy silently.',
        'In a <em>Perspective</em> in npj Digital Medicine, Ong et al. (2026) propose deliberate measures such as <em>minimum unaided practice</em>, clinical benchmarking, and scenario-based training to prevent competence erosion. This is not a clinical trial, but it is a useful formulation of the problem: without an explicit protocol, <strong>progressive delegation occurs by default.</strong>',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Verified professional deskilling — three months are sufficient to erode measurable clinical competence</div>'
      ],
      how: [
        '<strong>Sandwich model:</strong> think first → AI processes → you verify. Never start with the AI',
        'Reserve one case per week to solve without consulting the AI (deliberately)',
        'Personal semi-annual benchmark: compare your performance on equivalent tasks',
        'Ask yourself every month: am I delegating more today than 30 days ago?'
      ],
      refs: [
        { txt: 'Budzyń K, et al. Endoscopist deskilling risk after exposure to artificial intelligence in colonoscopy: a multicentre, observational study. Lancet Gastroenterol Hepatol. 2025;10(10):896-903.', url: 'https://doi.org/10.1016/S2468-1253(25)00133-5' },
        { txt: 'Ong AY, et al. Flight rules for clinical AI: lessons from aviation for human-AI collaboration in medicine. npj Digit Med. 2026;9:201.', url: 'https://doi.org/10.1038/s41746-026-02410-1' }
      ]
    }
  ],
  s2: [
    {
      id: 'e1', icon: '⚡', cat: 'Diagnosis vs. management paradox', risk: 'high',
      q: 'Do you know which tasks the AI genuinely adds value to, and which ones the evidence does not support?',
      why: [
        'Same research group, different tasks, opposite results: in JAMA Network Open (2024), Goh et al. found no improvement in diagnostic reasoning with LLM support compared to conventional resources. In Nature Medicine (2025), they observed a mean improvement of <strong>6.5 points</strong> on open-ended clinical management tasks.',
        'The same tool. Opposite results depending on the task. <strong>Generalising results from one domain to another is a frequent and consequential epistemological error.</strong>',
        '<div class="risk-banner rb-high">⚠️ High risk: Delegating diagnosis based on management studies — or vice versa</div>'
      ],
      how: [
        'Before delegating: is this <em>diagnosis</em> (think first yourself) or <em>management/triage</em> (AI may assist)?',
        'Treat AI studies like clinical trials: what was the exact outcome? Was it what you need?',
        'Ask the vendor: for which specific tasks is this system validated?'
      ],
      refs: [
        { txt: 'Goh E, et al. Large Language Model Influence on Diagnostic Reasoning: A Randomized Clinical Trial. JAMA Netw Open. 2024;7(10):e2440969.', url: 'https://doi.org/10.1001/jamanetworkopen.2024.40969' },
        { txt: 'Goh E, et al. GPT-4 assistance for improvement of physician performance on patient care tasks: a randomized controlled trial. Nat Med. 2025;31(4):1233-1238.', url: 'https://doi.org/10.1038/s41591-024-03456-y' }
      ]
    },
    {
      id: 'e2', icon: '🤖', cat: 'Automation bias — experts included', risk: 'crit',
      q: 'Do you know that automation bias affects experts and novices equally?',
      why: [
        'Parasuraman & Manzey (Human Factors, 2010): automation bias <strong>affects experts and novices equally</strong>. It is not overcome through simple training. Experience does not immunise.',
        'Dratsch et al. (Radiology, 2023): when faced with incorrect AI suggestions, performance dropped at all experience levels. Highly experienced radiologists resisted the bias better (45.5%) than moderately experienced (24.8%) and inexperienced (19.8%), but were also affected.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Expertise does not protect — deliberate protocol does</div>'
      ],
      how: [
        'Adopt deliberate protocols; do not rely on your experience to resist the bias',
        'When faced with AI suggestions: <strong>evaluate the case first</strong>, then compare with the AI',
        'Cases where you and the AI disagree are the most valuable for learning'
      ],
      refs: [
        { txt: 'Parasuraman R, Manzey D. Complacency and bias in human use of automation. Hum Factors. 2010;52(3):381-410.', url: 'https://pubmed.ncbi.nlm.nih.gov/21077562/' },
        { txt: 'Dratsch T, et al. Automation Bias in Mammography: The Impact of Artificial Intelligence BI-RADS Suggestions on Reader Performance. Radiology. 2023;307(4):e222176.', url: 'https://doi.org/10.1148/radiol.222176' }
      ]
    },
    {
      id: 'e3', icon: '💡', cat: 'The explainability trap', risk: 'high',
      q: 'Do you know that standard AI explanations may not reduce your overreliance?',
      why: [
        'The intuition is: if AI explains its reasoning (XAI), I will evaluate it better. The evidence says the opposite. Buçinca et al. (ACM HCI, 2021): standard XAI explanations <strong>do not reduce overreliance</strong> and in some contexts increase it.',
        'What does work are <em>cognitive forcing functions</em>: (1) deciding before seeing the AI, (2) on-demand access, (3) forced delay. Interface design is not neutral: <strong>it determines whether you think or delegate.</strong>',
        'Additionally, the explanation you see is mediated by interface design and by the <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;prompt_sistema&#39;)">system prompt</button>: it does not equate to direct access to the model\'s actual reasoning.',
        '<div class="risk-banner rb-high">⚠️ High risk: Confusing "explainable" with "safe" — explainability does not guarantee critical thinking</div>'
      ],
      how: [
        'Do not assume a tool that "shows its reasoning" is safer',
        'Assess whether the design requires you to commit to your diagnosis before seeing the suggestion',
        'Favour tools that only show AI output when you explicitly request it'
      ],
      refs: [
        { txt: 'Buçinca Z, et al. To trust or to think: cognitive forcing functions can reduce overreliance on AI. ACM CSCW. 2021.', url: 'https://doi.org/10.1145/3449287' }
      ]
    },
    {
      id: 'e4', icon: '🌍', cat: 'External validity', risk: 'high',
      q: 'Has the AI been validated in a population comparable to yours?',
      why: [
        'External validity is not assumed: it must be demonstrated. A system trained or validated in a different hospital, language, or population may degrade when the care setting changes.',
        'Rajkomar et al. (Annals of Internal Medicine, 2018) frame equity as a property that must be explicitly evaluated by subgroup and context of use, not as an automatic attribute of the model. What is validated in an Anglo-Saxon university hospital does not automatically apply in Spanish primary care.',
        'Biases are not only geographical: they are socioeconomic, gender-based, and age-related. AI inherits the biases of its training data — <strong>and can amplify them.</strong>',
        '<div class="risk-banner rb-high">⚠️ High risk: Diagnoses based on the dataset\'s epidemiology, not your practice\'s</div>'
      ],
      how: [
        'Ask: what is the validation population? Does it include primary care? Does it include Spain or the OECD?',
        'Cross-check the suggestion with the local prevalence in your area',
        'What is common in <em>your</em> practice is the most probable for <em>your</em> patients'
      ],
      refs: [
        { txt: 'Rajkomar A, et al. Ensuring fairness in ML for health equity. Ann Intern Med. 2018;169(12):866-872.', url: 'https://doi.org/10.7326/M18-1990' }
      ]
    }
  ],
  s3u: [
    {
      id: 'm1', icon: '🔒', cat: 'GDPR — clinical data', risk: 'crit',
      q: 'Do you know that health data is a "special category" and that its use in AI requires reinforced safeguards?',
      why: [
        'GDPR Art. 9 treats health data as a special category. If a third-party provider is involved, the framework of roles, instructions, and contractual safeguards under Art. 28 ceases to be a technical detail: it becomes part of compliance.',
        'Introducing identifiable patient data into an external LLM without anonymisation or clear institutional coverage may breach the GDPR. Before using the tool, you need to know the legal basis, the provider, and the conditions under which data is processed.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: GDPR breach — penalties up to €20M or 4% of global annual turnover</div>'
      ],
      how: [
        'Minimum protocol before pasting into the LLM: name → "M/F patient", dates → "age X", location → omit',
        '<strong>Never</strong> copy directly from the EHR into an LLM without prior anonymisation',
        'If using institutional AI: verify whether a data processing agreement with the provider exists',
        '30 seconds of anonymisation can prevent a potentially devastating sanction'
      ],
      refs: [{ txt: 'Regulation (EU) 2016/679 — GDPR, Art. 9 and 28.', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }]
    },
    {
      id: 'm2', icon: '📋', cat: 'AI Act — obligations in force', risk: 'high',
      q: 'Are you aware of the AI Act obligations applicable since February 2025?',
      why: [
        'AI Act Art. 4 requires providers and deployers to take measures to ensure a sufficient level of AI literacy. This obligation has applied since <strong>2 February 2025</strong>.',
        'For high-risk AI systems, Art. 14 requires effective human oversight: people with genuine competence, training, and authority to interpret output, intervene, and — where appropriate — stop or override the system. A human nominally "in the loop" is not sufficient.',
        '<div class="risk-banner rb-high">⚠️ Legal obligation in force — applicable since 2 February 2025</div>'
      ],
      how: [
        'Document your AI training (this tool counts as evidence of AI literacy)',
        'Ask your institution for an AI use protocol and accredited training',
        'For a high-risk AI system: verify that you can override its recommendation without friction'
      ],
      refs: [{ txt: 'Regulation (EU) 2024/1689 — AI Act, Art. 4 and 14.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' }]
    },
    {
      id: 'm3', icon: '🗣️', cat: 'Patient rights', risk: 'mod',
      q: 'Do you know whether you are required to inform the patient when AI participates in their care?',
      why: [
        'For certain high-risk AI uses, the AI Act provides patients with rights to information and explanation. Beyond regulation, the principle of autonomy and good clinical practice militate against concealing a relevant AI intervention in care.',
        'The exact scope depends on the type of system, the care setting, and applicable law, but the patient\'s question is legitimate. It is worth having a clear and honest answer prepared.',
        '<div class="risk-banner rb-mod">→ Transparency recommended now; legal obligations vary by case</div>'
      ],
      how: [
        'Adopt the <strong>transparency-by-default principle</strong>: inform patients when AI participates significantly',
        'Proactively engage: "Have you consulted any AI tool about your symptoms? What did it tell you?"',
        'If the patient asks how you reached a decision, be able to explain it without citing AI as the sole source'
      ],
      refs: [
        { txt: 'Regulation (EU) 2024/1689 — AI Act.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
        { txt: 'Kerasidou A, et al. Before and beyond trust: appropriate reliance on AI tools. J Med Ethics. 2021.', url: 'https://pubmed.ncbi.nlm.nih.gov/34426519/' }
      ]
    }
  ],
  s3bA: [
    {
      id: 'a1', icon: '🔐', cat: 'Systematic anonymisation', risk: 'crit',
      q: 'Do you systematically anonymise data before entering it into the LLM?',
      why: [
        'With general-purpose foundation model AI, if you use a personal account or an external service without a clear institutional framework, you cannot assume sufficient contractual coverage exists to process identifiable health data. Anonymisation ceases to be optional prudence and becomes a basic legal safety barrier.',
        'A breach does not require actual harm: it is sufficient that identifiable data was processed without a legal basis. Sanctions are real and the risk is not theoretical.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Direct exposure to a data protection breach</div>'
      ],
      how: [
        'Build a habit before pasting: name → "M/F patient", date of birth → "age X", location → omit',
        'For complex cases, work with fictional data equivalent to the real case',
        'Never use direct copy-paste from the EHR into the LLM chat'
      ],
      refs: [{ txt: 'Regulation (EU) 2016/679 — GDPR, Art. 9 and 28.', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }]
    },
    {
      id: 'a2', icon: '📝', cat: 'Self-defined operational limits', risk: 'high',
      q: 'Have you defined for which clinical tasks you use the LLM and for which you do not?',
      why: [
        'Without an explicit framework, <strong>progressive delegation occurs by default.</strong> Today you write a report. Tomorrow you request a diagnosis. The day after, you stop reviewing the output. This is the natural pattern of trust when a tool performs well.',
        'Calibrated trust requires explicit limits. Without defining them, calibration is impossible — only silent accumulation of risk.',
        'It is not the same to use an LLM as a notepad as to use it as <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;agentica&#39;)">agentic AI</button> connected to email, forms, or scheduling. When it also reads external inputs, the risk of <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;inyeccion_prompts&#39;)">prompt injection</button> arises: a hidden instruction in content can redirect the response or the action.',
        '<div class="risk-banner rb-high">⚠️ High risk: Progressive delegation without awareness of the threshold</div>'
      ],
      how: [
        'Write your personal list: "I use AI for [X, Y] / I do not use AI for [A, B]"',
        'Distinguish three levels of use in writing: drafting, analysing documents, and executing actions. Do not give them the same level of trust',
        'Review and update it every 6 months',
        'Share the list with a colleague: explaining your own limits reinforces metacognition'
      ],
      refs: [
        { txt: 'Dietvorst BJ, et al. Algorithm aversion. J Exp Psychol Gen. 2015;144(1):114-126.', url: 'https://pubmed.ncbi.nlm.nih.gov/25401381/' },
        { txt: 'Lee JD, See KA. Trust in automation: designing for appropriate reliance. Hum Factors. 2004;46(1):50-80.', url: 'https://pubmed.ncbi.nlm.nih.gov/15151155/' }
      ]
    },
    {
      id: 'a3', icon: '⚠️', cat: 'Liability and coverage', risk: 'crit',
      q: 'Do you know that using an LLM does not automatically transfer your professional liability?',
      why: [
        'The proposed AI Liability Directive was formally removed from the EU legislative procedure. This leaves unapproved a specific additional European regime designed to facilitate certain civil liability claims for AI-caused harm.',
        'If you integrate an LLM into a clinical decision, your conduct will continue to be assessed under the <em>lex artis</em>, documentation, and applicable national framework. You should not assume the provider will absorb the risk simply because the recommendation came from their system.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Assuming the provider will absorb harm without a clear legal basis</div>'
      ],
      how: [
        'Treat LLM output as the opinion of a colleague with no specialty: useful, but your signature is what counts',
        'Never base a high-stakes decision <em>solely</em> on an LLM without independent verification',
        'Read the terms of use: they typically limit liability, not expand it'
      ],
      refs: [
        { txt: 'Mello MM, Guha N. Understanding liability risk from using health care AI tools. NEJM. 2024;390(3):271-278.', url: 'https://doi.org/10.1056/NEJMhle2308901' },
        { txt: 'Procedure 2022/0303/COD — AI Liability Directive. Proposal withdrawn.', url: 'https://eur-lex.europa.eu/procedure/EN/2022_303' }
      ]
    }
  ],
  s3bB: [
    {
      id: 'b1', icon: '🏷️', cat: 'Certification and scope', risk: 'high',
      q: 'Have you verified that the system has CE marking and that its intended purpose covers your exact use?',
      why: [
        'The <em>intended purpose</em> delimits the scenario for which the manufacturer declares and validates the system\'s use. The fact that a tool has CE marking for one task does not automatically authorise extrapolating it to another.',
        'Using it outside that scope may place you outside the manufacturer\'s evaluated use case and alter the distribution of liability among manufacturer, facility, and clinician.',
        '<div class="risk-banner rb-high">⚠️ High risk: Use outside intended purpose — validation and coverage uncertain</div>'
      ],
      how: [
        'Consult EUDAMED and verify the intended purpose declared by the manufacturer',
        'Compare the intended purpose with the actual use you make of the system',
        'If there is a discrepancy: escalate to facility management before continuing'
      ],
      refs: [
        { txt: 'Regulation (EU) 2024/1689 — AI Act, Annex III.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
        { txt: 'Regulation (EU) 2017/745 — MDR.', url: 'https://eur-lex.europa.eu/eli/reg/2017/745/oj' }
      ]
    },
    {
      id: 'b2', icon: '⚕️', cat: 'Meaningful human oversight', risk: 'crit',
      q: 'Can you override the system\'s recommendation in fewer than two clicks and without friction?',
      why: [
        'AI Act Art. 14: effective human oversight is mandatory for high-risk AI systems. If the design makes it difficult or uncomfortable to deviate from the recommendation, that oversight becomes fragile or merely nominal.',
        'Goh et al. (Nature Medicine, 2025): the human+AI combination improved clinical management by +6.5pp, but at a cost of <strong>+119 seconds per case.</strong> In a 30-patient clinic, that is nearly 60 minutes of active oversight extra per day.',
        '<div class="risk-banner rb-crit">⛔ Critical risk: Oversight made impossible by design or by workload — the real effect is covert automation</div>'
      ],
      how: [
        'Test now: how many clicks does it take to reject the system\'s recommendation?',
        'Is there a record that you rejected the suggestion? If not, report it as a design deficiency',
        'Require management to budget oversight time into the working day'
      ],
      refs: [
        { txt: 'Regulation (EU) 2024/1689 — AI Act, Art. 14.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
        { txt: 'Goh E, et al. GPT-4 assistance for improvement of physician performance on patient care tasks: a randomized controlled trial. Nat Med. 2025;31(4):1233-1238.', url: 'https://doi.org/10.1038/s41591-024-03456-y' }
      ]
    },
    {
      id: 'b3', icon: '📊', cat: 'Validation in your context', risk: 'high',
      q: 'Was the system validated in a population and care setting comparable to yours?',
      why: [
        'Clinical AI literature continues to report technical performance far more frequently than safety outcomes in real-world practice. Mere analytical accuracy does not tell you what happens when the system is integrated into the clinical workflow.',
        'Choudhury & Asan (JMIR Medical Informatics, 2020) described a sparse and heterogeneous literature on clinical safety outcomes; DECIDE-AI was developed precisely to raise the standard of early evaluation in real-world settings.',
        'It is like approving a drug by measuring blood pressure reduction alone, without recording adverse events. <strong>University hospital validation ≠ paediatric primary care.</strong>',
        '<div class="risk-banner rb-high">⚠️ High risk: Adoption based on efficacy evidence without safety evidence</div>'
      ],
      how: [
        'Require the manufacturer to provide validation studies in a context comparable to yours',
        'Ask: does the study measure only whether the AI is correct, or also when it causes harm?',
        'If no validation exists in your context: document the limitation and report it to management'
      ],
      refs: [
        { txt: 'Vasey B, et al. Reporting guideline for AI-based diagnostic decision support (DECIDE-AI). Nat Med. 2022.', url: 'https://pubmed.ncbi.nlm.nih.gov/35585198/' },
        { txt: 'Choudhury A, Asan O. Role of Artificial Intelligence in Patient Safety Outcomes: Systematic Literature Review. JMIR Med Inform. 2020;8(7):e18599.', url: 'https://doi.org/10.2196/18599' }
      ]
    }
  ]
};

/* ── ADVANCED CRITERIA EN ── */
const CRIT_ADVANCED_EN = {
  s1: [
    {
      id: 'ya1', icon: '🗣️', cat: 'Patient communication', risk: 'mod', advanced: true,
      q: 'Have you adapted AI-generated information to the patient\'s level of understanding?',
      why: [
        'AI output is formulated in technical language. Relaying these texts literally generates confusion, anxiety, or false reassurance.',
        '<strong>The patient is already bringing AI to the consultation.</strong> Patients and families search for symptoms in AI at any hour, and some responses may sound longer, more organised, or more empathetic than human ones. That does not make them reliable individual clinical guidance.',
        'The action is not only to adapt your language — it is to <strong>anticipate the algorithmic misinformation</strong> the patient is already carrying.',
        '<div class="risk-banner rb-mod">→ Risk: Deterioration of the therapeutic relationship + patient\'s prior algorithmic misinformation</div>'
      ],
      how: [
        'Reformulate information in plain language with everyday analogies',
        'Ask the patient: "What have you understood from what we have discussed?"',
        '<strong>Proactively engage:</strong> "Have you consulted any AI tool about this? What did it tell you?"',
        'Do not delegate the explanation to AI: the therapeutic bond is yours'
      ],
      refs: [
        { txt: 'Schillinger D, et al. Closing the loop: physician communication. Arch Intern Med. 2003;163(1):83-90.', url: 'https://doi.org/10.1001/archinte.163.1.83' },
        { txt: 'Ayers JW, et al. Comparing physician and AI chatbot responses. JAMA Intern Med. 2023;183(6):589-596.', url: 'https://doi.org/10.1001/jamainternmed.2023.1838' }
      ]
    }
  ],
  s3u: [
    {
      id: 'ma1', icon: '📋', cat: 'Clinical documentation', risk: 'high', advanced: true,
      q: 'Have you thought about how to document AI use prudently in the clinical record?',
      why: [
        'According to Mello & Guha (NEJM, 2024), if AI use is recorded in the clinical record, that record becomes <em>discoverable</em> in legal proceedings. Not documenting leaves a gap; documenting imprudently can create evidence against you.',
        '<strong>The productivity paradox:</strong> clinicians <em>perceive</em> time savings with AI-generated documentation, but Goodson et al. (Learning Health Systems, 2025) argue that assuming net savings are generalizable remains premature. Reviewing the output carries its own cognitive cost. Copying output without review creates tainted legal documentation.',
        '<div class="risk-banner rb-high">⚠️ Risk: Perceived savings ≠ real savings — critical review is the hidden cost</div>'
      ],
      how: [
        'Note what tool, version, and date you used: LLM output is not fully <button type="button" class="inline-glossary-link" onclick="openGlossary(&#39;no_determinismo&#39;)">deterministic</button> and may differ after another run or an update',
        'Document your <strong>clinical reasoning</strong> and whether you followed or deviated from the recommendation, and why',
        'Do not copy AI output without your own critical review — what must appear on record is your judgement',
        'Budget time for review: AI drafts in 2 minutes, but critically reviewing it may take 5'
      ],
      refs: [
        { txt: 'Mello MM, Guha N. Understanding liability risk from using health care AI tools. NEJM. 2024;390(3):271-278.', url: 'https://doi.org/10.1056/NEJMhle2308901' },
        { txt: 'Goodson DA, et al. Artificial intelligence and physician burnout: A productivity paradox. Learn Health Syst. 2025;9(4):e70013.', url: 'https://doi.org/10.1002/lrh2.70013' }
      ]
    }
  ]
};

/* ── STATIONS EN ── */
const STATIONS_EN = [
  { id: 's1', n: 1, name: 'SELF',        sub: 'Clinical metacognition',       icon: '🧠', key: 's1',  count: 6 },
  { id: 's2', n: 2, name: 'EVIDENCE',    sub: 'What the science says',         icon: '📊', key: 's2',  count: 4 },
  { id: 's3', n: 3, name: 'FRAMEWORK',   sub: 'Regulation and accountability', icon: '⚖️', key: 's3u', count: '3+3' },
  { id: 's4', n: 4, name: 'CALIBRATION', sub: 'Your trust profile',            icon: '🎯', key: null,  count: null }
];

/* ── PROFILES EN ── */
const PROFILES_EN = {
  clinico:   { label: 'Healthcare clinician',                 all: true },
  farma:     { label: 'Pharmacist',                           highlight: ['y5','e4','m1','a1','a3','b1'] },
  gestor:    { label: 'Manager / executive',                  highlight: ['e1','m2','m3','b1','b2','b3','ma1'] },
  inspector: { label: 'Inspector / auditor',                  highlight: ['m1','m2','m3','a1','a3','b1','b2','ma1'] },
  central:   { label: 'Central services (quality, systems)',  highlight: ['e4','m2','b1','b2','b3','ma1'] },
  formador:  { label: 'Educator / academic',                  highlight: ['y6','e1','e2','e3','m2','ya1'] }
};

/* ── VULN MAP EN ── */
const VULN_MAP_EN = {
  y1:  { key: 'anclaje',       name: 'Anchoring bias' },
  y2:  { key: 'confirmacion',  name: 'Confirmation bias' },
  y3:  { key: 'contexto',      name: 'Context blindness' },
  y4:  { key: 'confianza',     name: 'Overconfidence · sycophancy' },
  y5:  { key: 'alucinacion',   name: 'Plausible hallucination' },
  y6:  { key: 'deskilling',    name: 'Clinical deskilling' },
  ya1: { key: 'comunicacion',  name: 'Algorithmic misinformation' },
  e1:  { key: 'generalizacion',name: 'Undue generalisation' },
  e2:  { key: 'automatizacion',name: 'Automation bias' },
  e3:  { key: 'xai',           name: 'Explainability trap' },
  e4:  { key: 'validez',       name: 'External validity bias' },
  m1:  { key: 'trazabilidad',  name: 'Traceability loss (GDPR)' },
  m2:  { key: 'alfabetizacion',name: 'AI literacy deficit' },
  m3:  { key: 'transparencia', name: 'Opacity towards the patient' },
  ma1: { key: 'documentacion', name: 'Imprudent documentation' },
  a1:  { key: 'trazabilidad',  name: 'Traceability loss (GDPR)' },
  a2:  { key: 'delegacion',    name: 'Progressive delegation' },
  a3:  { key: 'responsabilidad',name: 'Uncertain legal coverage' },
  b1:  { key: 'intended',      name: 'Use outside intended purpose' },
  b2:  { key: 'supervision',   name: 'Nominal human oversight' },
  b3:  { key: 'seguridad',     name: 'Efficacy without safety' }
};

/* ── VULN GLOSSARY EN ── */
const VULN_GLOSSARY_EN = [
  { key: 'anclaje',       name: 'Anchoring bias',          def: 'The first piece of data received sets the evaluation frame. Reading the AI\'s response before formulating your own hypothesis permanently contaminates subsequent reasoning — even in experts.' },
  { key: 'automatizacion',name: 'Automation bias',         def: 'The tendency to follow automatic recommendations even when they contradict one\'s own evidence. It affects experts as much as novices and is not neutralised by experience — only by deliberate protocol.' },
  { key: 'confianza',     name: 'Overconfidence · sycophancy', def: 'LLMs respond with equal assertiveness when correct and when they fabricate, and tend to confirm what the user has already suggested ("sycophancy"). Mistaking eloquence for knowledge is the subtlest and most common error.' },
  { key: 'alucinacion',   name: 'Plausible hallucination', def: 'The AI fabricates references, citations, or facts with the same plausible tone as real information. This is not a failure: it is an emergent property of the model.' },
  { key: 'deskilling',    name: 'Clinical deskilling',     def: 'Skills that are not practised atrophy. Three months of continuous delegation is sufficient to erode measurable clinical metrics (Budzyń et al., 2025).' },
  { key: 'trazabilidad',  name: 'Traceability loss',       def: 'Using foundation model AI with identifiable clinical data without a clear institutional framework makes it difficult to justify the legal basis, roles, and processing safeguards. The loss of traceability is both clinical and a data protection issue.' },
  { key: 'responsabilidad',name: 'Uncertain legal coverage',def: 'The withdrawal of the AI Liability Directive left unapproved a specific additional European regime for civil liability claims for AI-caused harm. This does not automatically transfer risk to the provider or eliminate it for the tool\'s user.' },
  { key: 'generalizacion',name: 'Undue generalisation',    def: 'Applying results validated for one task (e.g. clinical management) to a different one (e.g. diagnosis) without new validation. The same tool may help in one domain and cause harm in another.' },
  { key: 'xai',           name: 'Explainability trap',     def: 'The intuition is that if AI explains its reasoning we will be more critical. The evidence shows that standard explanations do not reduce overreliance — sometimes they increase it.' },
  { key: 'validez',       name: 'External validity bias',  def: 'What is validated in an Anglo-Saxon university hospital does not perform the same way in Spanish primary care. External validity must be demonstrated by population, context, and workflow — not assumed.' },
  { key: 'delegacion',    name: 'Progressive delegation',  def: 'Without explicit limits, AI use expands by default: first drafting, then suggesting, then deciding. The safety threshold is crossed without awareness.' },
  { key: 'supervision',   name: 'Nominal oversight',       def: 'If deviating from a recommendation is costly or confusing, human oversight may remain merely apparent, even though it formally exists.' },
  { key: 'seguridad',     name: 'Efficacy without safety', def: 'More than 90% of clinical AI studies measure whether the AI is correct, not whether it causes harm. Epidemiological validation does not equate to safety validation.' },
  { key: 'contexto',      name: 'Context blindness',       def: 'The AI has the record; it does not have the patient. The greater the psychosocial, family, or cultural complexity, the wider the gap between statistical accuracy and clinical usefulness.' },
  { key: 'confirmacion',  name: 'Confirmation bias',       def: 'Under time pressure, AI amplifies — rather than corrects — the clinician\'s first impression. Passively supervising is almost as dangerous as not supervising.' },
  { key: 'comunicacion',  name: 'Algorithmic misinformation', def: 'The patient is already bringing AI to the consultation. Some chatbot responses may sound convincing or empathetic; the clinical conversation must translate, contextualise, and correct where necessary.' },
  { key: 'alfabetizacion',name: 'AI literacy deficit',     def: 'AI Act Art. 4 requires providers and deployers to take measures to ensure AI literacy. This obligation began to apply on 2 February 2025.' },
  { key: 'transparencia', name: 'Opacity towards the patient', def: 'For certain high-risk AI uses, the AI Act recognises information and explanation rights for affected persons. Good clinical practice goes further: if AI has a material influence, being able to explain it is expected.' },
  { key: 'documentacion', name: 'Imprudent documentation', def: 'What is recorded in the clinical record is discoverable in legal proceedings. AI generates drafts in minutes; critically reviewing them takes time and is often skipped.' },
  { key: 'intended',      name: 'Use outside intended purpose', def: 'Using a SaMD outside its intended purpose places you outside the manufacturer\'s validated scenario and may alter liability distribution. CE marking is not an open authorisation for any use.' }
];

/* ── CONTEXT GLOSSARY EN ── */
const CONTEXT_GLOSSARY_EN = [
  { key: 'no_determinismo',   name: 'Non-determinism',        def: 'The same query does not always produce the same output. Minimal changes in wording, context, or version can alter the response; if it varies widely, read that as a signal of uncertainty, not as a tiebreaker.' },
  { key: 'fundamentacion',    name: 'Verifiable grounding',   def: 'The response draws on identifiable and verifiable documents rather than improvising from statistical memory. It reduces hallucinations but does not decide for you whether the evidence is robust or applicable to your patient.' },
  { key: 'prompt_sistema',    name: 'System prompt',          def: 'Invisible instructions the provider or tool gives the model before you write anything. The response depends not only on your question but also on those prior rules.' },
  { key: 'agentica',          name: 'Agentic AI',             def: 'AI use that not only responds, but reads inputs, makes decisions, and acts on tools or systems. The risk is no longer limited to a bad response — it extends to erroneous actions.' },
  { key: 'inyeccion_prompts', name: 'Prompt injection',       def: 'Hidden instructions embedded in documents, emails, or forms that an agent may interpret as valid commands. This matters especially when AI reads external content and can also execute actions.' }
];
