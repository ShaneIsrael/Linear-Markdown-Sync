import { LinearClient } from "@linear/sdk";

export interface IssueComment {
  author: string;
  createdAt: string;
  body: string;
}

export interface IssueAttachment {
  title: string;
  url: string;
  subtitle?: string;
  sourceType?: string;
}

export interface IssueData {
  identifier: string;
  title: string;
  description: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  state?: string;
  stateType?: string;
  assignee?: string;
  creator?: string;
  project?: string;
  team?: string;
  priority?: string;
  estimate?: number;
  labels: string[];
  attachments: IssueAttachment[];
  comments: IssueComment[];
}

export interface ParsedIdentifier {
  teamKey: string;
  number: number;
}

/**
 * Parses a folder name like "eng-730" into a team key and issue number.
 * Returns null when the name is not a valid Linear identifier.
 */
export function parseIdentifier(folderName: string): ParsedIdentifier | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(folderName.trim());
  if (!match) {
    return null;
  }
  return { teamKey: match[1].toUpperCase(), number: Number(match[2]) };
}

export function createClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

/**
 * Fetches a single issue by team key + number. Returns null if not found.
 */
export async function fetchIssue(
  client: LinearClient,
  parsed: ParsedIdentifier,
  includeComments: boolean
): Promise<IssueData | null> {
  const connection = await client.issues({
    first: 1,
    includeArchived: true,
    filter: {
      team: { key: { eq: parsed.teamKey } },
      number: { eq: parsed.number },
    },
  });

  const issue = connection.nodes[0];
  if (!issue) {
    return null;
  }

  const [state, assignee, creator, project, team, labelConn, attachmentConn] =
    await Promise.all([
      issue.state,
      issue.assignee,
      issue.creator,
      issue.project,
      issue.team,
      issue.labels({ first: 100 }),
      issue.attachments({ first: 100 }),
    ]);

  const attachments: IssueAttachment[] = attachmentConn.nodes.map((a) => ({
    title: a.title,
    url: a.url,
    subtitle: a.subtitle ?? undefined,
    sourceType: a.sourceType ?? undefined,
  }));

  let comments: IssueComment[] = [];
  if (includeComments) {
    const commentConn = await issue.comments({ first: 250 });
    comments = await Promise.all(
      commentConn.nodes.map(async (c) => {
        const user = await c.user;
        return {
          author: user?.displayName ?? user?.name ?? "Unknown",
          createdAt: c.createdAt.toISOString(),
          body: c.body ?? "",
        };
      })
    );
  }

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    url: issue.url,
    updatedAt: issue.updatedAt.toISOString(),
    createdAt: issue.createdAt.toISOString(),
    state: state?.name,
    stateType: state?.type,
    assignee: assignee?.displayName ?? assignee?.name,
    creator: creator?.displayName ?? creator?.name,
    project: project?.name,
    team: team?.name,
    priority: issue.priorityLabel,
    estimate: issue.estimate ?? undefined,
    labels: labelConn.nodes.map((l) => l.name),
    attachments,
    comments,
  };
}

/**
 * Validates an API key by issuing a lightweight authenticated request.
 * Returns the viewer's name on success; throws on auth failure.
 */
export async function verifyApiKey(client: LinearClient): Promise<string> {
  const me = await client.viewer;
  return me.displayName ?? me.name ?? me.email ?? "authenticated";
}
