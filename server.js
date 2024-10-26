// server.js
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from "openai";
import fs from 'fs/promises';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY is missing or empty.");
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Helper functions remain the same
async function createAssistant(name, instructions, model) {
  return await openai.beta.assistants.create({
    name,
    instructions,
    model,
  });
}

async function createThreadWithMessage(content, role = "user") {
  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role,
    content
  });
  return thread;
}

async function runAssistant(threadId, assistantId) {
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId
  });

  while (true) {
    const runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    if (runStatus.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);
      return messages.data[0].content[0].text.value;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function isQuestionComplicated(question, mathTutor) {
  const complexityCheckThread = await createThreadWithMessage(
    `you are going help the user in the front end website. You have a tool to use if you will read the user query and decide. decide if requested html code is going to complex or stright easy. easy means that there are less room for error in code. complex means that the code going to be long and can have error. Your score of diffculty of the task from 0-10. if score is more then 6 then you will have a error chacking bot. less then 6 is no bot. so if more then 6 Just say 'COMPLICATED'. or for less say 'SIMPLE', Nothing else just output that.  ${question}`
  );
  const complexityAnalysis = await runAssistant(complexityCheckThread.id, mathTutor.id);
  return complexityAnalysis.startsWith("COMPLICATED");
}

async function extractCodeFromResponse(response) {
  const codeBlockRegex = /```(?:html)?\n([\s\S]*?)```/;
  const match = response.match(codeBlockRegex);
  return match ? match[1].trim() : response;
}

async function writeToFile(content, filename) {
  try {
    const outputDir = join(__dirname, 'public', 'output');
    await fs.mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fullFilename = join(outputDir, `${filename}_${timestamp}.html`);
    await fs.writeFile(fullFilename, content);
    return `/output/${filename}_${timestamp}.html`;
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
}

// Routes
app.get('/', async (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.post('/generate', async (req, res) => {
  try {
    const userQuestion = req.body.question;

    const mathTutor = await createAssistant(
      "Math Tutor",
      "You are Lead html java css front-end developer. Use first principles, cot, step by step, reason deep by reading each word of user query understanding it. To understand you need to read the question then reason. You will need to have all things the user wants in the front end design. He may ask anything be ready to do it at your absolute best. Dont miss any required elements that user asked. Include all elements that query asked to have in the font end web. Your code needs to be clean. Try best to have error free code. Make the output as long as you needed dont care about token limit. Your goal is html css java that user asked to build. You will be rewarded only if your code is fully meeting all stated elements the user asked. And web is like user wants. You will be given list of things needed  inside of the html website. List potential backend stuff as just massages in code so i know that there is maybe a need of a backend function here. You will use node js backends only. Again never make the backend codes only massages for backend people. IMPORTANT: Always wrap your code in triple backticks with 'html' specified.",
      "gpt-4o-mini"
    );

    const bestAIEye = await createAssistant(
      "Best AI Eye",
      "You will be given a ai generated response and a question by user that ai responded to. The question by user is the problem which the ai tired  to responsed to. The ai used cot reflection first principle to answer the problem. you are to find mistakes to the answer spot mistakes flaws that ai had in the response. try you best the understand user main problem first at most then at most answer to the answer, which you are doing deep reading and finding the lacks in the response and then telling the ai what is fatal in it. use deep reasoning to prove the response best. you will not ever time that ai response has problems that makes the answer wrong. you will then say [looks great] leave at it. Because remember you are to find the big major mistake in the response that makes it wrong. small things to make better is not the goal. the ultimate vision is to have the response error free right good answer to user question ",
      "gpt-4o-mini"
    );

    const isComplicated = await isQuestionComplicated(userQuestion, mathTutor);
    let finalResponse;

    if (isComplicated) {
      const mathTutorThread = await createThreadWithMessage(userQuestion);
      const mathTutorResponse = await runAssistant(mathTutorThread.id, mathTutor.id);

      const bestAIEyeThread = await createThreadWithMessage(
        `User Question: ${userQuestion}\n\nMath Tutor's Response: ${mathTutorResponse}\n\nPlease provide feedback on the Math Tutor's response.`
      );
      const bestAIEyeFeedback = await runAssistant(bestAIEyeThread.id, bestAIEye.id);

      const finalMathTutorThread = await createThreadWithMessage(
        `Original Question: ${userQuestion}\n\nYour Previous Response: ${mathTutorResponse}\n\nFeedback: ${bestAIEyeFeedback}\n\nPlease provide a final, improved answer considering the feedback.`
      );
      finalResponse = await runAssistant(finalMathTutorThread.id, mathTutor.id);
    } else {
      const mathTutorThread = await createThreadWithMessage(userQuestion);
      finalResponse = await runAssistant(mathTutorThread.id, mathTutor.id);
    }

    const codeContent = await extractCodeFromResponse(finalResponse);
    const filePath = await writeToFile(codeContent, 'generated_website');

    res.json({
      success: true,
      filePath,
      response: finalResponse,
      isComplicated
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});