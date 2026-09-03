import type {
  SarahService, CreateConversationInput, CreateConversationResult,
  SendMessageInput, SendMessageResult, SubmitAnswerInput, SubmitAnswerResult,
  StartStudyModeInput, StartStudyModeResult, GenerateStudyPlanInput, StudyPlanResult,
  StartMockExamInput, MockExamResult, GradeMockExamInput, MockExamGradeResult,
  AnalyzeUploadInput, AnalyzeUploadResult, SarahHealthResult, SarahMessagePayload,
} from "./interface";

const CERT_DOMAINS: Record<string, string[]> = {
  "NSCA CSCS": ["Exercise Science", "Nutrition", "Program Design", "Testing & Evaluation", "Organization & Administration"],
  "NASM-CPT": ["Basic & Applied Sciences", "Assessment", "Program Design", "Exercise Technique", "Client Relations"],
  "ACSM-EP": ["Exercise Physiology", "Electrocardiography", "Health Appraisal", "Fitness Testing", "Emergency Management"],
  "ACE-CPT": ["Client Interviews", "Functional Assessments", "Physiological Assessments", "Program Design", "Progression"],
  "PMP": ["Integration Management", "Scope Management", "Schedule Management", "Cost Management", "Risk Management"],
  "CompTIA Security+": ["Threats & Attacks", "Cryptography", "Network Security", "Identity Management", "Risk Management"],
  "AWS Certified Solutions Architect": ["Design Secure Architectures", "Design Resilient Architectures", "High-Performing Architectures", "Cost-Optimized Architectures"],
};

function getDomains(certName: string): string[] {
  for (const [key, domains] of Object.entries(CERT_DOMAINS)) {
    if (certName.includes(key) || key.includes(certName)) return domains;
  }
  return ["Domain 1", "Domain 2", "Domain 3", "Domain 4", "Domain 5"];
}

function makeMockQuestion(certName: string, domain: string, questionNumber: number) {
  const domainQuestions: Record<string, { prompt: string; options: Array<{id:string;text:string}>; correct: string; explanation: string }> = {
    "NSCA CSCS": {
      prompt: "Which energy system provides the primary energy source for a 100-meter sprint?",
      options: [
        { id: "a", text: "Aerobic (oxidative) system" },
        { id: "b", text: "Phosphocreatine (ATP-PCr) system" },
        { id: "c", text: "Glycolytic (lactic acid) system" },
        { id: "d", text: "Gluconeogenesis pathway" },
      ],
      correct: "b",
      explanation: "The ATP-PCr system provides immediate energy for maximal efforts lasting 0-10 seconds, like a 100m sprint. It does not require oxygen and is replenished within 2-3 minutes of rest.",
    },
    "PMP": {
      prompt: "A project manager identifies a potential risk that could delay the project by three weeks. The risk probability is 30%. What is the BEST approach?",
      options: [
        { id: "a", text: "Accept the risk and do nothing" },
        { id: "b", text: "Develop a contingency plan for the risk" },
        { id: "c", text: "Escalate to the project sponsor immediately" },
        { id: "d", text: "Remove the activity that causes the risk" },
      ],
      correct: "b",
      explanation: "Developing a contingency plan is the BEST response. The risk has a 30% probability and significant impact, making it important to prepare a response without necessarily eliminating the work or escalating prematurely.",
    },
    "CompTIA Security+": {
      prompt: "Which type of attack involves an attacker inserting themselves between two communicating parties to intercept traffic?",
      options: [
        { id: "a", text: "Phishing attack" },
        { id: "b", text: "SQL injection attack" },
        { id: "c", text: "Man-in-the-Middle (MitM) attack" },
        { id: "d", text: "Denial-of-service attack" },
      ],
      correct: "c",
      explanation: "A Man-in-the-Middle attack occurs when an attacker secretly intercepts and potentially alters communication between two parties who believe they are directly communicating with each other.",
    },
    "AWS Certified Solutions Architect": {
      prompt: "A company needs a database solution that provides sub-millisecond latency for a high-traffic application. Which AWS service is MOST appropriate?",
      options: [
        { id: "a", text: "Amazon RDS for PostgreSQL" },
        { id: "b", text: "Amazon DynamoDB" },
        { id: "c", text: "Amazon Redshift" },
        { id: "d", text: "Amazon Aurora MySQL" },
      ],
      correct: "b",
      explanation: "Amazon DynamoDB is a fully managed NoSQL database service that provides single-digit millisecond latency at any scale, making it ideal for high-traffic applications requiring extremely low latency.",
    },
  };

  for (const [key, q] of Object.entries(domainQuestions)) {
    if (certName.includes(key) || key.includes(certName)) {
      return { ...q, questionNumber };
    }
  }

  // Generic fallback
  return {
    prompt: `Question ${questionNumber}: Regarding ${domain}, which of the following statements is MOST accurate?`,
    options: [
      { id: "a", text: `${domain} principle A is the foundational concept` },
      { id: "b", text: `${domain} principle B provides the optimal approach` },
      { id: "c", text: `${domain} principle C is preferred in practice` },
      { id: "d", text: `${domain} principles D must always be applied first` },
    ],
    correct: "b",
    explanation: `Option B correctly identifies the optimal approach for ${domain}. This is a fundamental concept you should understand thoroughly for the exam.`,
    questionNumber,
  };
}

export class MockSarahService implements SarahService {
  async createConversation(input: CreateConversationInput): Promise<CreateConversationResult> {
    return {
      conversationId: input.userId,
      openingMessage: {
        messageType: "text",
        content: "Hi, I'm Sarah. I'll help you prepare for your certification exam by identifying what you know, finding your weak areas, and teaching you how to reason through exam questions.\n\nWhich certification are you preparing for?",
        structuredData: null,
      },
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const { message, certificationName, mode } = input;
    const content = message.content.toLowerCase();

    // Certification selection detection
    const certKeywords = ["nsca", "cscs", "nasm", "cpt", "acsm", "ace", "pmp", "comptia", "security+", "aws", "architect"];
    const isCertSelection = certKeywords.some(k => content.includes(k));

    if (isCertSelection || content.includes("certification")) {
      return {
        responseMessages: [{
          messageType: "text",
          content: `Excellent choice! I'll help you ace that exam.\n\nTo build your personalized study plan, I need to understand where you are right now:\n\n**When is your exam date?** (Even a rough estimate helps me prioritize what to cover first.)`,
          structuredData: null,
        }],
        jobCompleted: true,
      };
    }

    // Exam date or scheduling
    if (content.match(/\d{4}|\bjanuary\b|\bfebruary\b|\bmarch\b|\bapril\b|\bmay\b|\bjune\b|\bjuly\b|\baugust\b|\bseptember\b|\boctober\b|\bnovember\b|\bdecember\b|months?|weeks?/) && !content.includes("?")) {
      return {
        responseMessages: [{
          messageType: "text",
          content: `Got it. That gives us good runway to work with.\n\nHow many hours per week can you realistically dedicate to studying? Be honest — I'll build a plan around your actual availability.`,
          structuredData: null,
        }],
        jobCompleted: true,
      };
    }

    // Study availability
    if (content.match(/\d+\s*hours?|\bhour\b|\bminutes?\b|\bweek\b|\bdaily\b|\beveryday\b/)) {
      return {
        responseMessages: [{
          messageType: "quick_actions",
          content: "Here's what I recommend we start with:",
          structuredData: {
            actions: [
              { id: "explain", label: "Explain a core concept", icon: "book" },
              { id: "quiz", label: "Test my knowledge", icon: "check-square" },
              { id: "plan", label: "Create study plan", icon: "calendar" },
              { id: "mock", label: "Take a mock exam", icon: "file-text" },
            ],
          },
        }],
        jobCompleted: true,
      };
    }

    // Question or quiz request
    if (content.includes("quiz") || content.includes("question") || content.includes("test me") || content.includes("practice")) {
      const domains = getDomains(certificationName || "");
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const q = makeMockQuestion(certificationName || "", domain, 1);
      return {
        responseMessages: [{
          messageType: "question_card",
          content: "Let's test your knowledge:",
          structuredData: {
            questionId: `mock-q-${Date.now()}`,
            domain,
            topic: domain,
            difficulty: "medium",
            prompt: q.prompt,
            options: q.options,
          },
        }],
        jobCompleted: true,
      };
    }

    // Study plan request
    if (content.includes("study plan") || content.includes("schedule")) {
      return {
        responseMessages: [{
          messageType: "study_plan",
          content: "Here's your personalized study plan:",
          structuredData: {
            planId: `mock-plan-${Date.now()}`,
            weeks: [
              { week: 1, focus: "Foundational Concepts", sessions: 4, hours: 8 },
              { week: 2, focus: "Core Domains", sessions: 4, hours: 8 },
              { week: 3, focus: "Practice & Application", sessions: 5, hours: 10 },
              { week: 4, focus: "Mock Exams & Review", sessions: 5, hours: 10 },
            ],
          },
        }],
        jobCompleted: true,
      };
    }

    // Mock exam request
    if (content.includes("mock exam") || content.includes("full exam") || content.includes("practice exam")) {
      return {
        responseMessages: [{
          messageType: "mock_exam_intro",
          content: "Ready to take a mock exam?",
          structuredData: {
            certificationName: certificationName || "Your Certification",
            questionCount: 50,
            timeLimitMinutes: 120,
            description: "This simulated exam mirrors the real exam format. You'll get a detailed breakdown of your performance by domain when you finish.",
          },
        }],
        jobCompleted: true,
      };
    }

    // Progress inquiry
    if (content.includes("progress") || content.includes("how am i doing") || content.includes("readiness") || content.includes("score")) {
      return {
        responseMessages: [{
          messageType: "progress_update",
          content: "Here's a snapshot of your current readiness:",
          structuredData: {
            readinessScore: 62,
            questionsAnswered: 47,
            accuracy: 74,
            studyStreak: 5,
            trend: "improving",
            domains: getDomains(certificationName || "").slice(0, 3).map((d, i) => ({
              domain: d,
              mastery: [45, 78, 60][i] ?? 50,
            })),
          },
        }],
        jobCompleted: true,
      };
    }

    // Explain something
    if (content.includes("explain") || content.includes("what is") || content.includes("describe") || content.includes("tell me")) {
      const topic = content.replace(/explain|what is|describe|tell me about/gi, "").trim() || "this concept";
      return {
        responseMessages: [{
          messageType: "text",
          content: `Great question about **${topic}**.\n\nThis is a high-yield topic for the exam. Let me break it down:\n\n**Definition:** ${topic} refers to the systematic approach used by professionals to achieve specific outcomes through evidence-based practice.\n\n**Why It Matters on the Exam:**\nThe exam will test your ability to apply this concept in practical scenarios. You'll often see questions that present a client situation and ask you to choose the most appropriate approach.\n\n**Key Points to Remember:**\n1. Always consider the individual's specific needs and limitations\n2. Apply the principle progressively — start conservative and advance based on response\n3. Document and reassess regularly\n\n**Exam Strategy:** When you see questions about ${topic}, eliminate answers that are too extreme or ignore individual variation. The correct answer usually involves assessment before intervention.\n\nWant me to give you a practice question on this to test your understanding?`,
          structuredData: null,
        }],
        jobCompleted: true,
      };
    }

    // Default mode-based responses
    const modeResponses: Record<string, SarahMessagePayload> = {
      "learn": {
        messageType: "text",
        content: `I understand. Let me help you learn this concept thoroughly.\n\nBased on your message, it sounds like you're asking about **${content.slice(0, 30)}...**\n\nThis is an important area for your exam. The key principle here is to understand both the theoretical framework and how to apply it in practical scenarios.\n\nWhat specific aspect would you like to explore further? I can:\n- Explain the underlying concepts\n- Show you how this appears on exam questions\n- Test your current understanding`,
        structuredData: null,
      },
      "practice": {
        messageType: "question_card",
        content: "Let's practice with a question:",
        structuredData: {
          questionId: `mock-q-${Date.now()}`,
          domain: getDomains(certificationName || "")[0] || "Core Concepts",
          topic: "Application",
          difficulty: "medium",
          prompt: `A client presents with the following situation: ${content.slice(0, 80)}. What is the MOST appropriate response?`,
          options: [
            { id: "a", text: "Conduct a thorough assessment before making any recommendations" },
            { id: "b", text: "Apply the standard protocol immediately" },
            { id: "c", text: "Refer to a specialist without further evaluation" },
            { id: "d", text: "Modify the program based on the presented information alone" },
          ],
        },
      },
      "review": {
        messageType: "text",
        content: `Good. Let's review this area.\n\nBased on your performance data, this topic has a **moderate mastery level**. Here's what you need to reinforce:\n\n**Concept Summary:**\n${content.slice(0, 60)}...\n\n**Common Exam Mistakes:**\n- Confusing this with related but distinct concepts\n- Applying general principles without considering individual factors\n- Not recognizing key qualifiers in the question stem\n\n**Memory Aid:** Think of it as a three-step process: Assess → Plan → Implement.\n\nReady for a practice question to confirm your understanding?`,
        structuredData: null,
      },
    };

    return {
      responseMessages: [modeResponses[mode] || modeResponses["learn"]],
      jobCompleted: true,
    };
  }

  async submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
    const { selectedOptionId, question } = input;
    const correct = selectedOptionId === question.correctAnswer;
    const optionExplanations: Record<string, string> = {};
    question.options.forEach(opt => {
      if (opt.id === question.correctAnswer) {
        optionExplanations[opt.id] = "This is correct. This answer best represents the principle being tested.";
      } else {
        optionExplanations[opt.id] = `This is incorrect. While ${opt.text.toLowerCase()} might seem reasonable, it does not fully address the scenario as described.`;
      }
    });

    return {
      correct,
      correctOptionId: question.correctAnswer,
      feedbackMessage: correct
        ? "Correct! Well done. You've demonstrated solid understanding of this concept."
        : `Not quite. The correct answer is option ${question.correctAnswer.toUpperCase()}. Let's review why.`,
      explanation: "This question tests your ability to apply core principles in a practical scenario.",
      optionExplanations,
      masteryUpdate: { domain: question.domain, newScore: correct ? 75 : 45 },
      nextQuestionId: null,
    };
  }

  async startStudyMode(input: StartStudyModeInput): Promise<StartStudyModeResult> {
    const modeMessages: Record<string, string> = {
      "learn": "We're now in **Learn mode**. I'll explain concepts, provide context, and build your understanding from the ground up. Ask me anything about your exam topics.",
      "practice": "We're now in **Practice mode**. I'll give you exam-style questions to test your knowledge. Focus on reasoning through each option carefully — the exam rewards systematic thinking.",
      "review": "We're now in **Review mode**. I'll focus on areas where you've shown weakness and help reinforce concepts you need to solidify before exam day.",
      "mock_exam": "I'll set up a **Mock Exam** for you now. This will mirror the real exam conditions. How many questions would you like? The standard is 50-100 questions.",
      "study_plan": "Let's build your **Study Plan**. Based on your exam date and available study time, I'll create a day-by-day schedule that covers all exam domains efficiently.",
    };

    return {
      message: {
        messageType: "text",
        content: modeMessages[input.mode] || modeMessages["learn"],
        structuredData: null,
      },
    };
  }

  async generateStudyPlan(input: GenerateStudyPlanInput): Promise<StudyPlanResult> {
    const domains = getDomains(input.certificationName);
    const today = new Date();
    const examDate = input.examDate ? new Date(input.examDate) : new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    const daysUntilExam = Math.max(7, Math.floor((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    const weeklyHours = input.weeklyHoursAvailable || 8;

    const items: StudyPlanResult["items"] = [];
    let currentDate = new Date(today);

    domains.forEach((domain, idx) => {
      const daysOffset = Math.floor((daysUntilExam * idx) / (domains.length + 2));
      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() + daysOffset);
      items.push({
        title: `Study: ${domain}`,
        description: `Deep dive into ${domain} concepts and exam applications`,
        scheduledDate: sessionDate.toISOString().split("T")[0],
        durationMinutes: Math.max(45, Math.floor((weeklyHours / 5) * 60)),
        itemType: "study",
        domain,
      });
    });

    // Add mock exam near the end
    const mockDate = new Date(examDate);
    mockDate.setDate(examDate.getDate() - 7);
    items.push({
      title: "Full Mock Exam",
      description: "Timed full-length mock exam under exam conditions",
      scheduledDate: mockDate.toISOString().split("T")[0],
      durationMinutes: 180,
      itemType: "mock_exam",
    });

    return {
      examDate: input.examDate,
      weeklyHoursAvailable: weeklyHours,
      weakDomains: input.weakDomains || [],
      strongDomains: input.strongDomains || [],
      milestones: [
        { title: "Complete all domain reviews", targetDate: new Date(today.getTime() + daysUntilExam * 0.6 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
        { title: "Pass mock exam with 75%+", targetDate: new Date(today.getTime() + daysUntilExam * 0.85 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
      ],
      items,
    };
  }

  async startMockExam(input: StartMockExamInput): Promise<MockExamResult> {
    const domains = getDomains(input.certificationName);
    const questionsPerDomain = Math.ceil(input.questionCount / domains.length);
    const questions: MockExamResult["questions"] = [];

    for (let i = 0; i < input.questionCount; i++) {
      const domain = domains[i % domains.length];
      const q = makeMockQuestion(input.certificationName, domain, i + 1);
      questions.push({
        questionNumber: i + 1,
        domain,
        prompt: q.prompt,
        options: q.options,
        correctOptionId: q.correct,
        explanation: q.explanation,
      });
    }

    return { questions };
  }

  async gradeMockExam(input: GradeMockExamInput): Promise<MockExamGradeResult> {
    const domainMap: Record<string, { correct: number; total: number }> = {};
    let correctCount = 0;

    for (const answer of input.answers) {
      const correct = answer.selectedOptionId === answer.correctOptionId;
      if (correct) correctCount++;
      if (!domainMap[answer.domain]) domainMap[answer.domain] = { correct: 0, total: 0 };
      domainMap[answer.domain].total++;
      if (correct) domainMap[answer.domain].correct++;
    }

    const score = (correctCount / input.answers.length) * 100;
    const domainBreakdown = Object.entries(domainMap).map(([domain, counts]) => ({
      domain,
      correctCount: counts.correct,
      totalCount: counts.total,
    }));

    return {
      score,
      correctCount,
      totalCount: input.answers.length,
      domainBreakdown,
      readinessUpdate: score >= 70 ? Math.min(100, score + 5) : score,
    };
  }

  async analyzeUpload(input: AnalyzeUploadInput): Promise<AnalyzeUploadResult> {
    return {
      message: {
        messageType: "upload_analysis",
        content: `I've received your file **${input.filename}**. Let me analyze it and extract the key concepts relevant to your exam preparation.`,
        structuredData: {
          filename: input.filename,
          status: "analyzed",
          topicsFound: ["Core Principles", "Applied Concepts", "Exam-relevant Material"],
          recommendation: "I've identified several exam-relevant topics in this document. I'll incorporate this material into our study sessions.",
        },
      },
      extractedTopics: ["Core Principles", "Applied Concepts"],
    };
  }

  async health(): Promise<SarahHealthResult> {
    return {
      status: "healthy",
      latencyMs: 12,
      message: "Mock Sarah service is running normally",
    };
  }
}
