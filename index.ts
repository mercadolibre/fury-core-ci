const core = require('@actions/core');
const Github = require('@actions/github');
import * as Webhooks from '@octokit/webhooks'
const semver = require('semver')

type BranchType = {
    pattern: RegExp,
    bump: 'patch' | 'minor' | 'major',
    label: string
}
const branches: Array<BranchType> = [
    {pattern: /^fix\/.*/, bump: "patch", label: "fix"},
    {pattern: /^feature\/.*/, bump: "minor", label: "feature"},
    {pattern: /^release\/.*/, bump: "major", label: "release"},
]

// most @actions toolkit packages have async methods
async function run() {
    try {
        const token = process.env['GITHUB_TOKEN']
        const octokit = new Github.GitHub(token);
        const {owner, repo} = Github.context.repo

        let prerelease = true
        let branch = ''
        let body = ''
        let releaseName = ''
        let prNumber = 0
        // if (Github.context.eventName === 'push') {
        //     const pushPayload = Github.context.payload as Webhooks.WebhookPayloadPush
        //     branch = pushPayload.ref.replace('refs/heads/', '')
        //     if (branch === 'master') {
        //         core.info('pushed to master, skipping')
        //         return
        //     }
        // }
        if (Github.context.eventName !== 'pull_request') {
            return
        }

        const prPayload = Github.context.payload as Webhooks.WebhookPayloadPullRequest
        // if (Github.context.eventName === 'pull_request') {
            if (prPayload.pull_request.base.ref !== 'master') {
                core.info('PR not to master, skipping')
                return
            }
            if (prPayload.pull_request.draft) {
                core.info('PR is a draft, skipping')
                return
            }
            if (!['opened', 'edited', 'closed', 'ready_for_review', 'synchronize'].includes(prPayload.action)) {
                core.info('PR action not supported, skipping')
                return
            }
            branch = prPayload.pull_request.head.ref
            // Branch name validation:
            // if(!patchRegex.test(branch) && !minorRegex.test(branch) && !majorRegex.test(branch)){
            //     throw new Error('Branch name pattern is not valid')
            // }
            // PR NOT merged:
            if (prPayload.action === 'closed' && !prPayload.pull_request.merged) {
                return
            }
            // PR merged:
            if (prPayload.action === 'closed' && prPayload.pull_request.merged) {
                prerelease = false
            }


            body = prPayload.pull_request.body
            prNumber = prPayload.number
            releaseName = prPayload.pull_request.title
        // }

        // Define tag and release name
        const prefix = prerelease ? 'pre' : ''
        const pattern = branches.find(branchPat => branchPat.pattern.test(branch))
        if(!pattern) {
            core.warning('branch pattern not expected, skipping')
            return
        }
        const bump = `${prefix}${pattern.bump}`

        const tags = await octokit.repos.listTags({
            owner,
            repo,
            per_page: 100
        });

        await octokit.issues.addLabels({
            repo,
            owner,
            issue_number: prPayload.pull_request.number,
            labels: [pattern.label]
        })

        let newTag = ""
        core.info('tags:')
        core.info(tags.data.map(tag => tag.name))
        const fullReleases = tags.data.filter(tag => !semver.prerelease(tag.name) && semver.valid(tag.name) === tag.name)
        const firstValid = fullReleases.find(tag => semver.valid(tag.name))
        core.info(`firstValid: ${firstValid && firstValid.name}`)
        let lastTag = firstValid ? firstValid.name : '0.0.0'
        if (prerelease) {
            const rcName = `rc-${branch.replace('/', '-')}`
            const rcs = tags.data.filter(tag => tag.name.includes(rcName))
            if (rcs.length !== 0) {
                // increase RC number
                newTag = semver.inc(rcs[0].name, 'prerelease')
            } else {
                // create RC
                newTag = semver.inc(lastTag, bump, rcName)
            }
        } else {
            newTag = semver.inc(lastTag, bump)
        }
        core.debug(`newTag: ${newTag}`)
        const createReleaseResponse = await octokit.repos.createRelease({
            owner,
            repo,
            tag_name: newTag,
            name: releaseName,
            body,
            draft: false,
            prerelease
        });
        // Get the ID, html_url, and upload URL for the created Release from the response
        // const {
        //     data: {id: releaseId, html_url: htmlUrl, upload_url: uploadUrl}
        // } = createReleaseResponse;
        if (createReleaseResponse.status === 201 && prNumber > 0) {
            const params = {
                repo,
                issue_number: prNumber,
                owner,
                body: `:label: ${prerelease ? 'Pre-release' : 'Release'} \`${newTag}\` created.`
            };
            const new_comment = await octokit.issues.createComment(params);
        }
        // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
        // core.setOutput('id', releaseId);
        // core.setOutput('html_url', htmlUrl);
        // core.setOutput('upload_url', uploadUrl);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run()
