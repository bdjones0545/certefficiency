CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_certifications_user_certification_uidx" ON "user_certifications" USING btree ("user_id","certification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_certifications_one_primary_per_user_uidx" ON "user_certifications" USING btree ("user_id") WHERE "user_certifications"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "user_certifications_certification_idx" ON "user_certifications" USING btree ("certification_id");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_certification_idx" ON "conversations" USING btree ("certification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_versions_message_version_uidx" ON "message_versions" USING btree ("message_id","version");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_sarah_job_idx" ON "messages" USING btree ("sarah_job_id");--> statement-breakpoint
CREATE INDEX "practice_attempts_user_created_idx" ON "practice_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "practice_attempts_question_idx" ON "practice_attempts" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "practice_questions_certification_difficulty_idx" ON "practice_questions" USING btree ("certification_id","difficulty");--> statement-breakpoint
CREATE INDEX "study_sessions_user_started_idx" ON "study_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_mastery_user_certification_domain_uidx" ON "topic_mastery" USING btree ("user_id","certification_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_exam_questions_exam_number_uidx" ON "mock_exam_questions" USING btree ("exam_id","question_number");--> statement-breakpoint
CREATE INDEX "mock_exams_user_created_idx" ON "mock_exams" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mock_exams_certification_idx" ON "mock_exams" USING btree ("certification_id");--> statement-breakpoint
CREATE INDEX "study_plan_items_plan_date_idx" ON "study_plan_items" USING btree ("study_plan_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "study_plans_user_status_idx" ON "study_plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "uploads_user_created_idx" ON "uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "uploads_conversation_idx" ON "uploads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "uploads_sarah_job_idx" ON "uploads" USING btree ("sarah_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sarah_job_attempts_job_number_uidx" ON "sarah_job_attempts" USING btree ("job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "sarah_jobs_user_created_idx" ON "sarah_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sarah_jobs_conversation_idx" ON "sarah_jobs" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_progress_user_course_lesson_uidx" ON "course_progress" USING btree ("user_id","course_id","lesson_number");--> statement-breakpoint
CREATE INDEX "course_purchases_user_course_idx" ON "course_purchases" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_purchases_stripe_session_uidx" ON "course_purchases" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "platform_enrollments_user_course_idx" ON "platform_enrollments" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_enrollments_stripe_session_uidx" ON "platform_enrollments" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_lesson_progress_user_lesson_uidx" ON "platform_lesson_progress" USING btree ("user_id","lesson_id");--> statement-breakpoint
CREATE INDEX "platform_lesson_progress_user_course_idx" ON "platform_lesson_progress" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_lessons_course_order_uidx" ON "platform_lessons" USING btree ("course_id","order");--> statement-breakpoint
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_weekly_hours_check" CHECK ("user_certifications"."weekly_hours" is null or ("user_certifications"."weekly_hours" >= 0 and "user_certifications"."weekly_hours" <= 168));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_message_count_check" CHECK ("conversations"."message_count" >= 0);--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_confidence_check" CHECK ("practice_attempts"."confidence_level" is null or ("practice_attempts"."confidence_level" >= 1 and "practice_attempts"."confidence_level" <= 5));--> statement-breakpoint
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_score_check" CHECK ("topic_mastery"."mastery_score" >= 0 and "topic_mastery"."mastery_score" <= 100);--> statement-breakpoint
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_question_counts_check" CHECK ("topic_mastery"."questions_answered" >= 0 and "topic_mastery"."correct_answers" >= 0 and "topic_mastery"."correct_answers" <= "topic_mastery"."questions_answered");--> statement-breakpoint
ALTER TABLE "mock_exam_questions" ADD CONSTRAINT "mock_exam_questions_number_check" CHECK ("mock_exam_questions"."question_number" > 0);--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_question_count_check" CHECK ("mock_exams"."question_count" > 0);--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_time_limit_check" CHECK ("mock_exams"."time_limit_minutes" is null or "mock_exams"."time_limit_minutes" > 0);--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_score_check" CHECK ("mock_exams"."score" is null or ("mock_exams"."score" >= 0 and "mock_exams"."score" <= 100));--> statement-breakpoint
ALTER TABLE "study_plan_items" ADD CONSTRAINT "study_plan_items_duration_check" CHECK ("study_plan_items"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_weekly_hours_check" CHECK ("study_plans"."weekly_hours_available" is null or ("study_plans"."weekly_hours_available" >= 0 and "study_plans"."weekly_hours_available" <= 168));--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size_bytes_check" CHECK ("uploads"."size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "sarah_job_attempts" ADD CONSTRAINT "sarah_job_attempts_number_check" CHECK ("sarah_job_attempts"."attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "sarah_jobs" ADD CONSTRAINT "sarah_jobs_attempt_count_check" CHECK ("sarah_jobs"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_lesson_number_check" CHECK ("course_progress"."lesson_number" > 0);--> statement-breakpoint
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_percentage_check" CHECK ("course_progress"."watch_percentage" >= 0 and "course_progress"."watch_percentage" <= 100);--> statement-breakpoint
ALTER TABLE "platform_courses" ADD CONSTRAINT "platform_courses_price_usd_check" CHECK ("platform_courses"."price_usd" >= 0);--> statement-breakpoint
ALTER TABLE "platform_lesson_progress" ADD CONSTRAINT "platform_lesson_progress_percentage_check" CHECK ("platform_lesson_progress"."watch_percentage" >= 0 and "platform_lesson_progress"."watch_percentage" <= 100);--> statement-breakpoint
ALTER TABLE "platform_lessons" ADD CONSTRAINT "platform_lessons_order_check" CHECK ("platform_lessons"."order" > 0);--> statement-breakpoint
ALTER TABLE "platform_lessons" ADD CONSTRAINT "platform_lessons_file_size_check" CHECK ("platform_lessons"."video_file_size_bytes" is null or "platform_lessons"."video_file_size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "platform_lessons" ADD CONSTRAINT "platform_lessons_duration_check" CHECK ("platform_lessons"."video_duration_secs" is null or "platform_lessons"."video_duration_secs" >= 0);