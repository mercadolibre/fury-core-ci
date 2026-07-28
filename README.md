# Fury Core CI

GitHub Action for creating Git tags in your Fury Core applications following [Semantic Versioning](https://semver.org/). All merged pull requests will be automatically tagged according to [SemVer rules](https://semver.org/).

> [!TIP]
> If you comment `#tag` in any pull request, the action will create a release candidate tag.

## Branch conventions

Your branches must follow a name convention, here's a list of them:

- `release/.*`: Labels pull request as **release** and increase the **MAJOR** version.
- `feature/.*`: Labels pull request as **feature** and increase the **MINOR** version.
- `chore/.*`: Labels pull request as **chore** without increasing the version.
- `fix/.*`: Labels pull request as **fix** and increase the **PATCH** version.
- `hotfix/.*`: Labels pull request as **fix** and increase the **PATCH** version.
- `revert-.*`: Labels pull request as **revert** and increase the **PATCH** version.

## Usage

Create `.github/workflows/tagging.yaml` file in your repository and paste the following content into it:

```yaml
name: Tagging
permissions: {}

on:
  pull_request:
    types:
      - opened
      - closed
      - edited
      - synchronize
      - ready_for_review
    branches:
      - master # Replace with your repository default main branch.

  issue_comment:
    types:
      - created

jobs:
  tag:
    name: Tag and release
    runs-on: ubuntu-latest

    permissions:
      issues: write # To add labels and create comments.
      actions: write # To trigger `build.yml` workflow when `trigger-build` input is `true`.
      contents: write # To create tags and releases.

     steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Push RC tag
        uses: mercadolibre/fury-core-ci@v1
        with:
          trigger-build: false # Trigger a build workflow defined in the repository actions. Default is `false`.
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

concurrency:
  group: tagging_${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
```

> [!IMPORTANT]
> To prevent security vulnerabilities, pin each action to a full length commit SHA associated with a published release.

### Outputs

| Output        | Description                        |
| ------------- | ---------------------------------- |
| `new_tag`     | Generated tag.                     |
| `pre_release` | Whether it is a release candidate. |
