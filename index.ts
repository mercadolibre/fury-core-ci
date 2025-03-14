import {exec} from 'child_process';
import * as core from '@actions/core';
import * as Github from '@actions/github';
import * as semver from 'semver';
import * as fs from 'fs';
import {ReleaseType} from "semver";

declare var process : {
    env: {
        GITHUB_TOKEN: string;
        VERSION_PREFIX: string;
    }
}


const allowedBaseBranch = /^([\w-]+:)?(?:master|main|develop)$/
type BranchType = {
    pattern: RegExp,
    bump: 'patch' | 'minor' | 'major' | 'chore',
    label: string
}
const branchTypes: Array<BranchType> = [
    {pattern: /^(\w*:)?hotfix\/([\w-]+)$/, bump: "patch", label: "fix"},
    {pattern: /^(\w*:)?fix\/([\w-]+)$/, bump: "patch", label: "fix"},
    {pattern: /^(\w*:)?feature\/([\w-]+)$/, bump: "minor", label: "feature"},
    {pattern: /^(\w*:)?release\/([\w-]+)$/, bump: "major", label: "release"},
    {pattern: /^(\w*:)?chore\/([\w-]+)$/, bump: "chore", label: "chore"},
    {pattern: /^revert-\d+-([\w-]+)$/, bump: "patch", label: "revert"},
]

const triggerBuild = core.getBooleanInput('trigger-build')
let token = core.getInput('gh_token');
if(token === "") {
    token = process.env['GITHUB_TOKEN']
}
const versionPrefix = process.env['VERSION_PREFIX'] || ""
const octokit = Github.getOctokit(token);
const {owner, repo} = Github.context.repo

// most @actions toolkit packages have async methods
async function run() {
    try {
        // Validate envs and inputs
        if(versionPrefix !== "" && /^([\w-]+)$/.test(versionPrefix) === false) {
            core.setFailed('Invalid version prefix.');
            return
        }

        let pr: WebhookPayloadPullRequestPullRequest

        // Extract from comment event
        if (Github.context.eventName === 'issue_comment') {
            const issuePayload = Github.context.payload
            if (issuePayload.action === 'created' && issuePayload.comment?.body.includes('#tag')) {
                const resp = await octokit.rest.pulls.get({
                    owner,
                    repo,
                    pull_number: issuePayload.issue?.number,
                })
                pr = resp.data

                // Validate commit status:
                // const commitStatus = await octokit.rest.repos.getCombinedStatusForRef({
                //     owner,
                //     repo,
                //     ref: pr.head.ref
                // })
                // core.info(JSON.stringify(commitStatus))
                // if(commitStatus.state !== "success") {
                //     await addComment(pr.number, `:warning: Successful checks are required to create a release candidate. :warning:`);
                //     core.setFailed('Successful checks are required to create a release candidate.');
                //     return
                // }

                // Validate approval:
                // const reviews = await octokit.rest.pulls.listReviews({
                //     owner,
                //     repo,
                //     pull_number: pr.number,
                //     per_page: 100
                // });
                // if(reviews.data.length === 100){
                //     core.warning('max reviews per page, restriction may be false')
                // }
                // let approved = false
                // for (const review of reviews.data) {
                //     if(review.state === 'APPROVED') {
                //         approved = true
                //     }
                // }
                // if(!approved) {
                //     await addComment(pr.number, `:warning: An approval is required to create a release candidate. :warning:`);
                //     core.setFailed('An approval is required to create a release candidate.');
                //     return
                // }

                const newTag = await createTag(pr)
                if(triggerBuild) {
                    // Trigger build workflow:
                    const dispatch = await octokit.rest.actions.createWorkflowDispatch({
                        owner,
                        repo,
                        workflow_id: 'build.yml',
                        ref: newTag,
                    })
                    core.info(`dispatch status: ${dispatch.status}`)
                }
            }
            return
        }

        // Extract from pull_request event
        if (Github.context.eventName === 'pull_request') {
            const prPayload = Github.context.payload as WebhookPayloadPullRequest
            // Opened:
            if (prPayload.action === 'opened') {
                await addLabel(prPayload.pull_request)
                await addComment(prPayload.number, `Add a comment including \`#tag\` to create a release candidate tag.`)
                return
            }
            // Continue only when PR is closed and merged:
            if (!(prPayload.action === 'closed' && prPayload.pull_request.merged)) {
                return
            }
            pr = prPayload.pull_request
            const newTag = await createTag(pr)
            if(triggerBuild) {
                // Trigger build workflow:
                const dispatch = await octokit.rest.actions.createWorkflowDispatch({
                    owner,
                    repo,
                    workflow_id: 'build.yml',
                    ref: newTag,
                })
                core.info(`dispatch status: ${dispatch.status}`)
            }
            return
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

async function addLabel(pr: WebhookPayloadPullRequestPullRequest) {
    const pattern = branchTypes.find(branchPat => branchPat.pattern.test(pr.head.ref))
    // Branch name validation:
    if (!pattern) {
        core.setFailed('Invalid branch name pattern')
        return
    }
    await octokit.rest.issues.addLabels({
        repo,
        owner,
        issue_number: pr.number,
        labels: [pattern.label]
    })
}

async function addComment(prNumber:number, body:string) {
    const params = {
        repo,
        issue_number: prNumber,
        owner,
        body
    };
    await octokit.rest.issues.createComment(params);
}

async function bash(cmd:string) {
    return new Promise<{stdout: string, stderr:string}>(function (resolve, reject) {
        exec(cmd, {maxBuffer: 10 * 1024 * 1024},(err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve({stdout, stderr});
            }
        });
    });
}
async function getLastTag() :Promise<string> {
    const rev = await bash(`git tag  | grep -E '^${versionPrefix}[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -V | tail -1`)
    return rev.stdout.trim()
}
async function getLastRC(name:string) :Promise<string> {
    const rev = await bash(`git tag  | grep -E '${name}' | sort -V | tail -1`)
    return rev.stdout.trim()
}

function updateFile(file: string, update: (x:string) => string) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, `# Changelog
All notable changes to this project will be documented in this file.
`, 'utf-8')
    }
    const data = fs.readFileSync(file, 'utf-8')
    const newData = update(data)
    fs.writeFileSync(file, newData, 'utf-8')
}

async function createTag(pr: WebhookPayloadPullRequestPullRequest) {
    // Additional validations
    if (!pr) {
        core.warning('PR not found')
        return
    }
    if (!allowedBaseBranch.test(pr.base.ref)) {
        core.info(`PR not to allowed base branch (${pr.base.ref}), skipping`)
        return
    }
    if (pr.draft) {
        core.info('PR is a draft, skipping')
        return
    }

    const preRelease = !pr.merged
    const branch = pr.head.ref
    const prNumber = pr.number

    // Define tag and release name
    const prefix = preRelease ? 'pre' : ''
    const pattern = branchTypes.find(branchPat => branchPat.pattern.test(branch))
    // Branch name validation:
    if (!pattern) {
        core.setFailed('Invalid branch name pattern');
        return
    }
    if(pattern.bump == 'chore'){
        return
    }

    // Tagging
    await bash(`git fetch --prune --tags`)
    let newTag = ""
    // Find last valid tag (not RC)
    let lastTag = await getLastTag()
    lastTag = lastTag ? lastTag: '0.0.0'
    core.info(`lastTag: ${lastTag}`)
    const bump = `${prefix}${pattern.bump}`
    if (preRelease) {
        const rcName = `rc-${branch.replace(/[^a-zA-Z0-9-]/g, '-')}`
        const lastRC = await getLastRC(rcName)
        if (lastRC) {
            // increase RC number
            newTag = semver.inc(lastRC, 'prerelease' as ReleaseType)
        } else {
            // create RC
            newTag = semver.inc(lastTag, bump as ReleaseType, rcName)
        }
    } else {
        newTag = semver.inc(lastTag, bump as ReleaseType)
    }
    newTag = `${versionPrefix}${newTag}`
    core.info(`newTag: ${newTag}`)
    // Create release
    const createReleaseResponse = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: newTag,
        name: pr.title,
        body: pr.body || `PR #${pr.number}`,
        draft: false,
        prerelease: preRelease,
        target_commitish: preRelease ? pr.head.ref : pr.base.ref
    });
    if (createReleaseResponse.status !== 201 && prNumber > 0) {
        core.setFailed('Failed to create release');
        return
    }

    core.setOutput("new_tag", newTag);
    core.setOutput("pre_release", preRelease);

    // Create comment
    await addComment(prNumber, `:label: ${preRelease ? 'Pre-release' : 'Release'} \`${newTag}\` created. [See build.](https://circleci.com/gh/melisource/${repo})`)

    return newTag
}

run()


type WebhookPayloadPullRequestPullRequest = {
    url: string;
    id: number;
    node_id: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
    issue_url: string;
    number: number;
    state: string;
    locked: boolean;
    title: string;
    body: string;
    created_at: string;
    updated_at: string;
    closed_at: null | string;
    merged_at: null | string;
    merge_commit_sha: null | string;
    requested_reviewers?: Array<any>;
    requested_teams?: Array<any>;
    commits_url: string;
    review_comments_url: string;
    review_comment_url: string;
    comments_url: string;
    statuses_url: string;
    head: WebhookPayloadPullRequestPullRequestHead;
    base: WebhookPayloadPullRequestPullRequestBase;
    author_association: string;
    draft?: boolean;
    merged: boolean;
    mergeable: null | boolean;
    rebaseable?: null | boolean;
    mergeable_state: string;
    merged_by: null|any;
    comments: number;
    review_comments: number;
    maintainer_can_modify: boolean;
    commits: number;
    additions: number;
    deletions: number;
    changed_files: number;
};
type WebhookPayloadPullRequestPullRequestBase = {
    label: string;
    ref: string;
    sha: string;
};
type WebhookPayloadPullRequestPullRequestHead = {
    label: string;
    ref: string;
    sha: string;
};
type WebhookPayloadPullRequest = {
    action: string;
    number: number;
    pull_request: WebhookPayloadPullRequestPullRequest;
};