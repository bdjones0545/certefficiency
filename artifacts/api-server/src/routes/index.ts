import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import certificationsRouter from "./certifications";
import conversationsRouter from "./conversations";
import practiceRouter from "./practice";
import mockExamsRouter from "./mockExams";
import studyPlansRouter from "./studyPlans";
import progressRouter from "./progress";
import uploadsRouter from "./uploads";
import settingsRouter from "./settings";
import sarahRouter from "./sarah";
import coursesRouter from "./courses";
import courseplatformRouter from "./courseplatform";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(certificationsRouter);
router.use(conversationsRouter);
router.use(practiceRouter);
router.use(mockExamsRouter);
router.use(studyPlansRouter);
router.use(progressRouter);
router.use(uploadsRouter);
router.use(settingsRouter);
router.use(sarahRouter);
router.use(coursesRouter);
router.use(courseplatformRouter);

export default router;
