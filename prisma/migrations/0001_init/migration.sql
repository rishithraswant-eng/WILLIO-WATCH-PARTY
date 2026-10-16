-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('HOST', 'MOD', 'VIEWER');

-- CreateEnum
CREATE TYPE "ControlMode" AS ENUM ('HOST_ONLY', 'EVERYONE', 'VOTE');

-- CreateEnum
CREATE TYPE "WaitPolicy" AS ENUM ('WAIT_FOR_ALL', 'NEVER_WAIT');

-- CreateEnum
CREATE TYPE "PollType" AS ENUM ('GENERIC', 'NEXT_MOVIE', 'SKIP_TO', 'PAUSE_BREAK', 'CONTROL');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StreamType" AS ENUM ('MP4', 'HLS', 'YOUTUBE');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "hostUserId" TEXT,
    "hostEpoch" INTEGER NOT NULL DEFAULT 0,
    "controlMode" "ControlMode" NOT NULL DEFAULT 'HOST_ONLY',
    "waitPolicy" "WaitPolicy" NOT NULL DEFAULT 'WAIT_FOR_ALL',
    "maxUsers" INTEGER NOT NULL DEFAULT 50,
    "currentMediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarSeed" TEXT NOT NULL,
    "tasteVector" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "overview" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "runtimeMin" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "popularity" DOUBLE PRECISION NOT NULL,
    "language" TEXT NOT NULL,
    "genres" TEXT[],
    "keywords" TEXT[],
    "cast" TEXT[],
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "trailerUrl" TEXT,
    "streamUrl" TEXT,
    "streamType" "StreamType",
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "moods" TEXT[],

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "movieId" TEXT,
    "customUrl" TEXT,
    "title" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "playedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueVote" (
    "queueItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QueueVote_pkey" PRIMARY KEY ("queueItemId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "text" VARCHAR(600) NOT NULL,
    "videoTs" DOUBLE PRECISION,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" BIGSERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "videoTs" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "creatorId" TEXT,
    "question" TEXT NOT NULL,
    "type" "PollType" NOT NULL DEFAULT 'GENERIC',
    "options" JSONB NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "result" JSONB,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("pollId","userId")
);

-- CreateTable
CREATE TABLE "SyncSample" (
    "id" BIGSERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rttMs" DOUBLE PRECISION NOT NULL,
    "offsetMs" DOUBLE PRECISION NOT NULL,
    "driftMs" DOUBLE PRECISION NOT NULL,
    "mode" TEXT NOT NULL,

    CONSTRAINT "SyncSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropagationSample" (
    "id" BIGSERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "users" INTEGER NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p95" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropagationSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchRun" (
    "id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "users" INTEGER NOT NULL,
    "durationS" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "Room_lastActiveAt_idx" ON "Room"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_roomId_userId_key" ON "Participant"("roomId", "userId");

-- CreateIndex
CREATE INDEX "Movie_title_idx" ON "Movie"("title");

-- CreateIndex
CREATE INDEX "Movie_year_idx" ON "Movie"("year");

-- CreateIndex
CREATE INDEX "Movie_rating_idx" ON "Movie"("rating");

-- CreateIndex
CREATE INDEX "QueueItem_roomId_position_idx" ON "QueueItem"("roomId", "position");

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Reaction_mediaId_videoTs_idx" ON "Reaction"("mediaId", "videoTs");

-- CreateIndex
CREATE INDEX "Reaction_roomId_idx" ON "Reaction"("roomId");

-- CreateIndex
CREATE INDEX "SyncSample_roomId_ts_idx" ON "SyncSample"("roomId", "ts");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

