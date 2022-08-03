# Fury Core CI

CI workflow for creating git tags in your Fury Core Applications, the generated tags follows the standards of [Semantic Versioning](https://semver.org/).

#### Versioning

All merged PR's will be tagged according to the corresponding Semantic Version.

#### Release Candidates

You can write a comment `#tag` in any Pull Request to create a release candidate tag. 

### How to use

Put the following file in `.github/workflows/tagging.yml`

```yml
# .github/workflows/tagging.yml
name: Tagging workflow

on:
  issue_comment:
    types: [created]
  pull_request:
    branches: [master]
    types: [opened, synchronize, ready_for_review, edited, closed]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Push RC tag
        uses: mercadolibre/fury-core-ci@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Branching conventions

Your branchs must follow a name convention, here's a list of them:

 - `release/.*`: labels PR as **feature** and increase the **major**
   version
 - `feature/.*`: labels PR as **feature** and increase the **minor**
   version
 - `fix/.*`: labels PR as **fix** and increase the **patch** version
 - `revert-.*`: labels PR as **revert** and increase the **patch** version
 - `chore/.*`: labels PR as **chore** without incresing the version
